// ...existing code...
import { v4 as uuidv4 } from 'uuid';
import { chatRepository } from './chat.repository.js';
import type {
  IConversation,
  IConversationMember,
  IMessage,
  ICreateConversationDto,
  ISendMessageDto,
  ILastMessage,
  IUpdateGroupDto,
  IAddMembersDto,
  IChangeRoleDto,
} from './chat.types.js';
import { NotFoundError, ForbiddenError } from '@/shared/utils/errors.js';
import { kafkaProducer } from '@/shared/kafka/producer.js';
import { KAFKA_TOPICS } from '@/shared/constants/kafkaTopics.js';
import { userRepository } from '@/modules/user/user.repository.js';
import { mediaService } from '@/modules/media/media.service.js';
import type { MemberRole } from '@/shared/types/chat.types.js';

async function lastMessageSnapshotFromNewest(messages: IMessage[]): Promise<ILastMessage | null> {
  if (messages.length === 0) return null;
  const m = messages[0];
  let content = m.content ?? '';
  if (m.isRecalled) content = 'Tin nhắn đã được thu hồi';
  else if (m.isDeleted) content = 'Tin nhắn đã được xóa';
  const senders = await userRepository.findByIds([m.senderId]);
  const senderDisplayName = senders[0]?.displayName?.trim() ?? null;
  return {
    messageId: m.messageId,
    senderId: m.senderId,
    type: m.type,
    content,
    createdAt: m.createdAt,
    senderDisplayName,
  };
}

async function syncConversationLastMessageMeta(conversationId: string): Promise<void> {
  const messages = await chatRepository.getMessages(conversationId, 100);
  const snapshot = await lastMessageSnapshotFromNewest(messages);
  if (!snapshot) {
    await chatRepository.clearConversationLastMessage(conversationId);
    return;
  }
  await chatRepository.updateConversationLastMessage(conversationId, snapshot, snapshot.createdAt);
}

async function attachSenderDisplayNames(messages: IMessage[]): Promise<IMessage[]> {
  if (messages.length === 0) return messages;
  const senderIds = [...new Set(messages.map((m) => m.senderId))];
  const users = await userRepository.findByIds(senderIds);
  const nameById = new Map(users.map((u) => [u.userId, u.displayName]));
  return messages.map((msg) => ({
    ...msg,
    senderDisplayName: nameById.get(msg.senderId) ?? null,
  }));
}

async function attachReplyToDetails(
  conversationId: string,
  messages: IMessage[],
): Promise<IMessage[]> {
  const replyToIds = messages
    .map((m) => m.replyTo)
    .filter((id): id is string => id !== null && id !== undefined);

  if (replyToIds.length === 0) return messages;

  const allMessagesInConv = await chatRepository.getMessages(conversationId, 100);
  const msgMap = new Map(allMessagesInConv.map((m) => [m.messageId, m]));

  const senderIds = [...new Set(allMessagesInConv.map((m) => m.senderId))];
  const users = await userRepository.findByIds(senderIds);
  const nameById = new Map(users.map((u) => [u.userId, u.displayName]));

  return messages.map((msg) => {
    if (!msg.replyTo) return msg;
    const original = msgMap.get(msg.replyTo);
    if (!original) return msg;

    let content = original.content;
    if (original.isRecalled) content = 'Tin nhắn đã được thu hồi';
    if (original.isDeleted) content = 'Tin nhắn đã được xóa';

    return {
      ...msg,
      replyToDetails: {
        messageId: original.messageId,
        senderId: original.senderId,
        senderDisplayName: nameById.get(original.senderId) ?? null,
        content: content.slice(0, 100),
        type: original.type,
      },
    };
  });
}

export const chatService = {
    /**
     * Lấy danh sách thành viên nhóm (group)
     */
    getGroupMembers: async (groupId: string): Promise<IConversationMember[]> => {
      return chatRepository.getConversationMembers(groupId);
    },
  // ─── Conversations ────────────────────────────────────────────────────

  getConversations: async (userId: string): Promise<IConversation[]> => {
    const conversations = await chatRepository.getConversations(userId);
    const directConversations = conversations.filter(
      (conversation) => conversation.type === 'direct',
    );

    if (directConversations.length === 0) {
      return conversations;
    }

    const membersPerConversation = await Promise.all(
      directConversations.map((conversation) =>
        chatRepository.getConversationMembers(conversation.conversationId),
      ),
    );

    const otherUserIds = [
      ...new Set(
        membersPerConversation.flatMap((members) =>
          members.filter((member) => member.userId !== userId).map((member) => member.userId),
        ),
      ),
    ];

    const otherUsers = await userRepository.findByIds(otherUserIds);
    const userMap = new Map(otherUsers.map((user) => [user.userId, user]));

    directConversations.forEach((conversation, index) => {
      const otherMember = membersPerConversation[index].find((member) => member.userId !== userId);
      if (!otherMember) return;

      const otherUser = userMap.get(otherMember.userId);
      if (!otherUser) return;

      conversation.name = otherUser.displayName;
      conversation.avatar = otherUser.avatar ?? undefined;
      (conversation as IConversation & { otherUserId?: string }).otherUserId = otherMember.userId;
    });

    return conversations;
  },

  /**
   * Tạo conversation mới (direct hoặc group).
   * Với direct: kiểm tra đã tồn tại conv 1-1 chưa, nếu có thì trả về conv cũ.
   */
  createConversation: async (
    creatorId: string,
    data: ICreateConversationDto,
  ): Promise<IConversation> => {
    const allMemberIds = Array.from(new Set([creatorId, ...data.memberIds]));

    // Với direct chat, tìm conv đã tồn tại
    if (data.type === 'direct' && allMemberIds.length === 2) {
      const otherId = allMemberIds.find((id) => id !== creatorId)!;
      const existing = await chatRepository.findDirectConversation(creatorId, otherId);
      if (existing) return existing;
    }

    const now = new Date().toISOString();
    const conversationId = uuidv4();

    const conversation: IConversation = {
      conversationId,
      type: data.type,
      ...(data.name != null && data.name !== '' ? { name: data.name } : {}),
      creatorId,
      memberCount: allMemberIds.length,
      isEncrypted: false,
      createdAt: now,
      updatedAt: now,
    };

    await chatRepository.createConversation(conversation);

    // Thêm tất cả thành viên
    await Promise.all(
      allMemberIds.map((userId, index) => {
        const member: IConversationMember = {
          conversationId,
          userId,
          role: index === 0 ? 'owner' : 'member',
          joinedAt: now,
          unreadCount: 0,
          isMuted: false,
        };
        return chatRepository.addConversationMember(member);
      }),
    );

    // Tạo system message thông báo tạo nhóm mới
    if (data.type === 'group') {
      let creatorName = 'Ai đó';
      try {
        const users = await userRepository.findByIds([creatorId]);
        creatorName = users[0]?.displayName || 'Ai đó';
      } catch {}
      const messageId = uuidv4();
      const systemMessage: IMessage = {
        messageId,
        conversationId,
        senderId: creatorId,
        senderDisplayName: creatorName,
        type: 'system' as any,
        content: `${creatorName} đã tạo nhóm${data.name ? ` "${data.name}"` : ''}`,
        encryptedContent: null,
        mediaUrl: null,
        mediaType: null,
        mediaSize: null,
        thumbnailUrl: null,
        replyTo: null,
        replyToDetails: null,
        forwardFrom: null,
        isPinned: false,
        isEdited: false,
        isRecalled: false,
        isDeleted: false,
        reactions: {},
        createdAt: now,
        updatedAt: now,
      };
      await chatRepository.createMessage(systemMessage);
      await chatRepository.updateConversationLastMessage(conversationId, {
        messageId,
        senderId: creatorId,
        content: systemMessage.content,
        type: 'system' as any,
        createdAt: now,
        senderDisplayName: creatorName,
      }, now);
      try {
        const { broadcastMessageNew } = await import('./chat.broadcast.js');
        await broadcastMessageNew(systemMessage);
      } catch {/* ignore broadcast errors */}
    }

    return conversation;
  },

  getConversationById: async (conversationId: string, userId: string): Promise<IConversation> => {
    const conversation = await chatRepository.getConversationById(conversationId);
    if (!conversation) throw new NotFoundError('Hội thoại');

    // Kiểm tra user có phải thành viên không
    const members = await chatRepository.getConversationMembers(conversationId);
    const isMember = members.some((m) => m.userId === userId);
    if (!isMember) throw new ForbiddenError('Bạn không phải thành viên của hội thoại này');

    return conversation;
  },

  // ─── Messages ─────────────────────────────────────────────────────────

  getMessages: async (conversationId: string, limit?: number): Promise<IMessage[]> => {
    const messages = await chatRepository.getMessages(conversationId, limit);
    const withNames = await attachSenderDisplayNames(messages);
    return attachReplyToDetails(conversationId, withNames);
  },

  /**
   * Gửi tin nhắn:
   * 1. Lưu message vào DynamoDB
   * 2. Cập nhật lastMessage trên conversation
   * 3. Produce Kafka event để notification module xử lý push notification
   */
  sendMessage: async (
    senderId: string,
    conversationId: string,
    data: ISendMessageDto,
  ): Promise<IMessage> => {
    const conversation = await chatRepository.getConversationById(conversationId);
    if (!conversation) throw new NotFoundError('Hội thoại');

    const now = new Date().toISOString();
    const messageId = uuidv4();

    let mediaUrl: string | null = data.mediaUrl ?? null;
    let mediaType: string | null = null;
    let mediaSize: number | null = null;
    let mediaOriginalName: string | null = null;
    let thumbnailUrl: string | null = null;

    if (data.mediaId) {
      const resolved = await mediaService.getMediaForMessageAttach(data.mediaId, senderId);
      mediaUrl = resolved.mediaUrl;
      mediaType = resolved.mediaType;
      mediaSize = resolved.mediaSize;
      mediaOriginalName = resolved.originalName;
      thumbnailUrl = resolved.thumbnailUrl;
    }

    const message: IMessage = {
      messageId,
      conversationId,
      senderId,
      type: data.type,
      content: data.content,
      encryptedContent: null,
      mediaUrl,
      mediaType,
      mediaSize,
      mediaOriginalName,
      thumbnailUrl,
      replyTo: data.replyTo ?? null,
      forwardFrom: null,
      isPinned: false,
      isEdited: false,
      isRecalled: false,
      isDeleted: false,
      reactions: {},
      createdAt: now,
      updatedAt: now,
    };

    await chatRepository.createMessage(message);

    const senders = await userRepository.findByIds([senderId]);
    const senderDisplayName = senders[0]?.displayName?.trim() ?? null;

    const withSenderName: IMessage = { ...message, senderDisplayName };
    const [messageForClient] = await attachReplyToDetails(conversationId, [withSenderName]);

    const lastPreviewContent =
      message.content.trim() !== ''
        ? message.content
        : message.type === 'image'
          ? '[Ảnh]'
          : message.type === 'video'
            ? '[Video]'
            : message.type === 'file'
              ? '[File]'
              : message.content;

    // Cập nhật lastMessage trên conversation
    await chatRepository.updateConversationLastMessage(
      conversationId,
      {
        messageId,
        senderId,
        content: lastPreviewContent,
        type: data.type,
        createdAt: now,
        senderDisplayName,
      },
      now,
    );

    // Tăng unreadCount cho các member còn lại
    const members = await chatRepository.getConversationMembers(conversationId);
    const otherMembers = members.filter((m) => m.userId !== senderId);

    await Promise.all([
      // Tăng unread cho members khác
      ...otherMembers.map((m) =>
        chatRepository.updateMemberUnreadCount(conversationId, m.userId, 1),
      ),
      // Produce Kafka event để gửi push notification
      kafkaProducer.send(KAFKA_TOPICS.NOTIFICATION_EVENTS, {
        type: 'NEW_MESSAGE',
        payload: {
          conversationId,
          senderId,
          messageId,
          messagePreview: lastPreviewContent.slice(0, 100),
          recipientIds: otherMembers.map((m) => m.userId),
        },
      }),
    ]);

    return messageForClient;
  },

  /**
   * Chỉnh sửa nội dung tin nhắn.
   * Chỉ người gửi mới được chỉnh sửa.
   */
  editMessage: async (
    messageId: string,
    content: string,
    senderId: string,
    conversationId: string,
    createdAt: string,
  ): Promise<void> => {
    const message = await chatRepository.getMessageById(conversationId, messageId, createdAt);
    if (!message) throw new NotFoundError('Tin nhắn');
    if (message.senderId !== senderId) throw new ForbiddenError('Chỉ người gửi mới được chỉnh sửa');

    const sortKey = `MSG#${message.createdAt}#${messageId}`;
    await chatRepository.updateMessage(conversationId, messageId, sortKey, {
      content,
      isEdited: true,
    });
    await syncConversationLastMessageMeta(conversationId);
  },

  /**
   * Soft delete tin nhắn.
   */
  deleteMessage: async (
    messageId: string,
    senderId: string,
    conversationId: string,
    createdAt: string,
  ): Promise<void> => {
    const message = await chatRepository.getMessageById(conversationId, messageId, createdAt);
    if (!message) throw new NotFoundError('Tin nhắn');
    if (message.senderId !== senderId) throw new ForbiddenError('Chỉ người gửi mới được xóa');

    const sortKey = `MSG#${message.createdAt}#${messageId}`;
    await chatRepository.updateMessage(conversationId, messageId, sortKey, {
      isDeleted: true,
      isPinned: false,
    });
    await syncConversationLastMessageMeta(conversationId);
  },

  /**
   * Thu hồi tin nhắn (hiển thị "Tin nhắn đã được thu hồi").
   */
  recallMessage: async (
    messageId: string,
    senderId: string,
    conversationId: string,
    createdAt: string,
  ): Promise<void> => {
    const message = await chatRepository.getMessageById(conversationId, messageId, createdAt);
    if (!message) throw new NotFoundError('Tin nhắn');
    if (message.senderId !== senderId) throw new ForbiddenError('Chỉ người gửi mới được thu hồi');

    const sortKey = `MSG#${message.createdAt}#${messageId}`;
    await chatRepository.updateMessage(conversationId, messageId, sortKey, {
      isRecalled: true,
      content: 'Tin nhắn đã được thu hồi',
      isPinned: false,
    });
    await syncConversationLastMessageMeta(conversationId);
  },

  /**
   * Đánh dấu tin nhắn đã đọc, reset unreadCount.
   */
  markAsRead: async (conversationId: string, userId: string, messageId: string): Promise<void> => {
    await Promise.all([
      chatRepository.updateMessageStatus(messageId, userId, 'read'),
      chatRepository.resetMemberUnreadCount(conversationId, userId),
    ]);
  },

  // ─── Ghim / Bỏ ghim ──────────────────────────────────────────────────

  pinMessage: async (
    messageId: string,
    conversationId: string,
    createdAt: string,
  ): Promise<void> => {
    const sortKey = `MSG#${createdAt}#${messageId}`;
    await chatRepository.updateMessage(conversationId, messageId, sortKey, {
      isPinned: true,
    });
  },

  unpinMessage: async (
    messageId: string,
    conversationId: string,
    createdAt: string,
  ): Promise<void> => {
    const sortKey = `MSG#${createdAt}#${messageId}`;
    await chatRepository.updateMessage(conversationId, messageId, sortKey, {
      isPinned: false,
    });
  },

  /**
   * Thả cảm xúc trên tin nhắn
   */
  reactToMessage: async (
    messageId: string,
    userId: string,
    conversationId: string,
    createdAt: string,
    emoji: string,
  ): Promise<Record<string, string[]>> => {
    const message = await chatRepository.getMessageById(conversationId, messageId, createdAt);
    if (!message) throw new NotFoundError('Tin nhắn');

    const reactions = { ...(message.reactions || {}) };
    let usersWithThisEmoji = reactions[emoji] || [];

    if (usersWithThisEmoji.includes(userId)) {
      // Đã thả emoji này -> hủy thả
      usersWithThisEmoji = usersWithThisEmoji.filter((id) => id !== userId);
      if (usersWithThisEmoji.length === 0) {
        delete reactions[emoji];
      } else {
        reactions[emoji] = usersWithThisEmoji;
      }
    } else {
      // Chưa thả -> xóa emoji cũ của user này (mỗi user 1 cảm xúc/tin nhắn) rồi thêm emoji mới
      for (const [key, userList] of Object.entries(reactions)) {
        if (userList.includes(userId)) {
          const newList = userList.filter((id) => id !== userId);
          if (newList.length === 0) {
            delete reactions[key];
          } else {
            reactions[key] = newList;
          }
        }
      }
      reactions[emoji] = [...(reactions[emoji] || []), userId];
    }

    const sortKey = `MSG#${message.createdAt}#${messageId}`;
    await chatRepository.updateMessage(conversationId, messageId, sortKey, {
      reactions,
    });

    return reactions;
  },

  // ─── Group Management Service Extensions ──────────────────────────


  updateGroup: async (
    requesterId: string,
    conversationId: string,
    data: IUpdateGroupDto,
  ): Promise<IConversation> => {
    const conversation = await chatRepository.getConversationById(conversationId);
    if (!conversation) throw new NotFoundError('Nhóm');
    if (conversation.type !== 'group') throw new ForbiddenError('Đây không phải nhóm chat');

    const member = await chatRepository.getMember(conversationId, requesterId);
    if (!member) {
      throw new ForbiddenError('Bạn không phải thành viên của nhóm này');
    }


    // Detect group name/avatar change
    const oldName = conversation.name || '';
    const oldAvatar = conversation.avatar || '';
    const newAvatar = data.avatar || oldAvatar;
    const isAvatarChanged = data.avatar && data.avatar !== oldAvatar;

    await chatRepository.updateConversation(conversationId, data);
    const updatedConversation = { ...conversation, ...data, updatedAt: new Date().toISOString() };

    // Get requester display name (for both cases)
    let userName = '';
    try {
      const users = await userRepository.findByIds([requesterId]);
      userName = users[0]?.displayName || 'Ai đó';
    } catch { userName = 'Ai đó'; }

    // If group name changed, create and broadcast a system message
    if (data.name && data.name !== oldName) {
      const now = new Date().toISOString();
      const messageId = uuidv4();
      const systemMessage: IMessage = {
        messageId,
        conversationId,
        senderId: requesterId,
        senderDisplayName: userName,
        type: 'system' as any,
        content: `${userName} đổi tên nhóm thành '${data.name}'`,
        encryptedContent: undefined,
        mediaUrl: undefined,
        mediaType: undefined,
        mediaSize: undefined,
        thumbnailUrl: undefined,
        replyTo: undefined,
        replyToDetails: undefined,
        forwardFrom: undefined,
        isPinned: false,
        isEdited: false,
        isRecalled: false,
        isDeleted: false,
        reactions: {},
        createdAt: now,
        updatedAt: now,
      };
      await chatRepository.createMessage(systemMessage);
      await chatRepository.updateConversationLastMessage(conversationId, {
        messageId,
        senderId: requesterId,
        content: systemMessage.content,
        type: 'system' as any,
        createdAt: now,
        senderDisplayName: userName,
      }, now);
      try {
        const { broadcastMessageNew } = await import('./chat.broadcast.js');
        await broadcastMessageNew(systemMessage);
      } catch {/* ignore broadcast errors */}
    }

    // If group avatar changed, create and broadcast a system message
    if (data.avatar && data.avatar !== oldAvatar) {
      const now = new Date().toISOString();
      const messageId = uuidv4();
      // Nếu người gửi là chính họ, xưng "Bạn"; còn lại dùng tên
      let content = '';
      if (requesterId === conversation.currentUserId) {
        content = 'Ảnh đại diện nhóm đã thay đổi';
      } else {
        content = `${userName} đã cập nhật ảnh đại diện nhóm`;
      }
      const systemMessage: IMessage = {
        messageId,
        conversationId,
        senderId: requesterId,
        senderDisplayName: userName,
        type: 'system' as any,
        content,
        encryptedContent: undefined,
        mediaUrl: data.avatar,
        mediaType: 'image',
        mediaSize: undefined,
        thumbnailUrl: undefined,
        replyTo: undefined,
        replyToDetails: undefined,
        forwardFrom: undefined,
        isPinned: false,
        isEdited: false,
        isRecalled: false,
        isDeleted: false,
        reactions: {},
        createdAt: now,
        updatedAt: now,
      };
      await chatRepository.createMessage(systemMessage);
      await chatRepository.updateConversationLastMessage(conversationId, {
        messageId,
        senderId: requesterId,
        content: systemMessage.content,
        type: 'system' as any,
        createdAt: now,
        senderDisplayName: userName,
      }, now);
      try {
        const { broadcastMessageNew } = await import('./chat.broadcast.js');
        await broadcastMessageNew(systemMessage);
      } catch {/* ignore broadcast errors */}
    }

    return updatedConversation;
  },

  deleteGroup: async (requesterId: string, conversationId: string): Promise<void> => {
    const conversation = await chatRepository.getConversationById(conversationId);
    if (!conversation) throw new NotFoundError('Nhóm');
    if (conversation.type !== 'group') throw new ForbiddenError('Đây không phải nhóm chat');
    if (conversation.creatorId !== requesterId) {
      throw new ForbiddenError('Chỉ người tạo nhóm mới có quyền giải tán');
    }

    // Soft delete bằng cách gán cờ isDeleted hoặc xóa META (ở đây xóa hẳn theo repo cũ hoặc gán cờ)
    // Theo repo mở rộng tôi vừa viết: repo.updateConversation
    await chatRepository.updateConversation(conversationId, {
      name: `[ĐÃ GIẢI TÁN] ${conversation.name}`,
      isDeleted: true,
    } as any);
  },

  leaveGroup: async (userId: string, conversationId: string): Promise<void> => {
    const member = await chatRepository.getMember(conversationId, userId);
    if (!member) throw new NotFoundError('Thành viên nhóm');
    if (member.role === 'owner') {
      throw new Error('Chủ nhóm không thể rời. Hãy chuyển quyền hoặc giải tán nhóm.');
    }

    await chatRepository.removeMember(conversationId, userId);

    const conv = await chatRepository.getConversationById(conversationId);
    if (conv) {
      await chatRepository.updateConversation(conversationId, {
        memberCount: Math.max(0, (conv.memberCount || 0) - 1),
      });
    }
  },

  addMembers: async (
    requesterId: string,
    conversationId: string,
    data: IAddMembersDto,
  ): Promise<void> => {
    const member = await chatRepository.getMember(conversationId, requesterId);
    // Giữ check cũ (admin/owner) nhưng mở rộng: chỉ cần là thành viên của nhóm thì có thể thêm.
    // Backend vẫn là nguồn kiểm soát quyền; nếu muốn siết lại thì chỉ cần bỏ nhánh này.
    if (!member || !['owner', 'admin', 'member'].includes(member.role)) {
      throw new ForbiddenError('Bạn không có quyền thêm thành viên');
    }

    const now = new Date().toISOString();
    await Promise.all(
      data.memberIds.map((userId) =>
        chatRepository.addConversationMember({
          conversationId,
          userId,
          role: 'member',
          joinedAt: now,
          unreadCount: 0,
          isMuted: false,
        }),
      ),
    );

    const conv = await chatRepository.getConversationById(conversationId);
    if (conv) {
      await chatRepository.updateConversation(conversationId, {
        memberCount: (conv.memberCount || 0) + data.memberIds.length,
      });
    }

    // System message: ai đã thêm ai vào nhóm (hiển thị giữa khung chat) + đồng bộ realtime
    try {
      let requesterName = 'Ai đó';
      try {
        const users = await userRepository.findByIds([requesterId]);
        requesterName = users[0]?.displayName || requesterName;
      } catch {}

      let addedNames: string[] = [];
      try {
        const addedProfiles = await userRepository.findByIds(data.memberIds);
        const nameById = new Map(addedProfiles.map((u) => [u.userId, u.displayName || u.email || u.userId]));
        addedNames = data.memberIds.map((id) => nameById.get(id) ?? id);
      } catch {
        addedNames = data.memberIds;
      }

      const previewList = addedNames.slice(0, 3).join(', ');
      const moreCount = Math.max(0, addedNames.length - 3);
      const addedLabel = moreCount > 0 ? `${previewList} và ${moreCount} người khác` : previewList;

      const messageId = uuidv4();
      const systemMessage: IMessage = {
        messageId,
        conversationId,
        senderId: requesterId,
        senderDisplayName: requesterName,
        type: 'system' as any,
        content: `${requesterName} đã thêm ${addedLabel} vào nhóm`,
        encryptedContent: null,
        mediaUrl: null,
        mediaType: null,
        mediaSize: null,
        mediaOriginalName: null,
        thumbnailUrl: null,
        replyTo: null,
        replyToDetails: null,
        forwardFrom: null,
        isPinned: false,
        isEdited: false,
        isRecalled: false,
        isDeleted: false,
        reactions: {},
        createdAt: now,
        updatedAt: now,
      };
      await chatRepository.createMessage(systemMessage);
      await chatRepository.updateConversationLastMessage(
        conversationId,
        {
          messageId,
          senderId: requesterId,
          content: systemMessage.content,
          type: 'system' as any,
          createdAt: now,
          senderDisplayName: requesterName,
        },
        now,
      );
      try {
        const { broadcastMessageNew } = await import('./chat.broadcast.js');
        await broadcastMessageNew(systemMessage);
      } catch {/* ignore broadcast errors */}
    } catch {
      // ignore system message errors, do not fail main addMembers flow
    }
  },

  removeMember: async (
    requesterId: string,
    conversationId: string,
    targetUserId: string,
  ): Promise<void> => {
    const requester = await chatRepository.getMember(conversationId, requesterId);
    if (!requester || !['owner', 'admin'].includes(requester.role)) {
      throw new ForbiddenError('Chỉ Admin/Owner mới có quyền xóa thành viên');
    }

    const target = await chatRepository.getMember(conversationId, targetUserId);
    if (!target) throw new NotFoundError('Thành viên');
    if (target.role === 'owner') throw new ForbiddenError('Không thể xóa chủ nhóm');

    await chatRepository.removeMember(conversationId, targetUserId);

    const conv = await chatRepository.getConversationById(conversationId);
    if (conv) {
      await chatRepository.updateConversation(conversationId, {
        memberCount: Math.max(0, (conv.memberCount || 0) - 1),
      });
    }
  },

  changeMemberRole: async (
    requesterId: string,
    conversationId: string,
    targetUserId: string,
    role: MemberRole,
  ): Promise<void> => {
    const requester = await chatRepository.getMember(conversationId, requesterId);
    if (!requester || requester.role !== 'owner') {
      throw new ForbiddenError('Chỉ Owner mới có quyền thay đổi vai trò Admin');
    }

    await chatRepository.updateMemberRole(conversationId, targetUserId, role);
  },

  // ─── Member Requests (Duyệt thành viên) ──────────────────────────────

  joinRequest: async (userId: string, conversationId: string): Promise<void> => {
    const conv = await chatRepository.getConversationById(conversationId);
    if (!conv) throw new NotFoundError('Hội thoại');
    await chatRepository.createGroupRequest(conversationId, userId);
  },

  getGroupRequests: async (conversationId: string, requesterId: string): Promise<any[]> => {
    const member = await chatRepository.getMember(conversationId, requesterId);
    if (!member || !['owner', 'admin'].includes(member.role)) {
      throw new ForbiddenError('Chỉ Admin/Owner mới xem được danh sách chờ');
    }
    return chatRepository.getGroupRequests(conversationId);
  },

  approveRequest: async (conversationId: string, requesterId: string, targetUserId: string): Promise<void> => {
    const member = await chatRepository.getMember(conversationId, requesterId);
    if (!member || !['owner', 'admin'].includes(member.role)) {
      throw new ForbiddenError('Chỉ Admin/Owner mới có quyền duyệt');
    }
    
    await chatRepository.addConversationMember({
      conversationId,
      userId: targetUserId,
      role: 'member',
      joinedAt: new Date().toISOString(),
      unreadCount: 0,
      isMuted: false,
    });
    
    const conv = await chatRepository.getConversationById(conversationId);
    if (conv) {
      await chatRepository.updateConversation(conversationId, { memberCount: (conv.memberCount || 0) + 1 });
    }
    
    await chatRepository.removeGroupRequest(conversationId, targetUserId);
  },

  rejectRequest: async (conversationId: string, requesterId: string, targetUserId: string): Promise<void> => {
    const member = await chatRepository.getMember(conversationId, requesterId);
    if (!member || !['owner', 'admin'].includes(member.role)) {
      throw new ForbiddenError('Chỉ Admin/Owner mới có quyền từ chối');
    }
    await chatRepository.removeGroupRequest(conversationId, targetUserId);
  },

  // ─── Polls (Bình chọn) ───────────────────────────────────────────────

  createPoll: async (requesterId: string, conversationId: string, data: any): Promise<void> => {
    const pollId = uuidv4();
    const poll = {
      pollId,
      conversationId,
      creatorId: requesterId,
      question: data.question,
      options: data.options.map((opt: string) => ({ text: opt, vofers: [] })),
      isMultipleChoice: data.isMultipleChoice || false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await chatRepository.createPoll(poll);
  },

  getPolls: async (conversationId: string): Promise<any[]> => {
    return chatRepository.getPolls(conversationId);
  },

  votePoll: async (userId: string, conversationId: string, pollId: string, optionIndex: number): Promise<void> => {
    const polls = await chatRepository.getPolls(conversationId);
    const poll = polls.find(p => p.pollId === pollId);
    if (!poll) throw new NotFoundError('Bình chọn');

    // Logic bỏ phiếu (đơn giản hóa: bỏ phiếu cho 1 option)
    if (!poll.options[optionIndex]) throw new Error('Lựa chọn không hợp lệ');
    
    // Nếu chưa bầu thì thêm vào
    if (!poll.options[optionIndex].voters) poll.options[optionIndex].voters = [];
    if (!poll.options[optionIndex].voters.includes(userId)) {
      poll.options[optionIndex].voters.push(userId);
    }
    
    await chatRepository.updatePollVotes(conversationId, pollId, poll.options);
  },

  unvotePoll: async (userId: string, conversationId: string, pollId: string, optionIndex: number): Promise<void> => {
    const polls = await chatRepository.getPolls(conversationId);
    const poll = polls.find(p => p.pollId === pollId);
    if (!poll) throw new NotFoundError('Bình chọn');

    if (poll.options[optionIndex] && poll.options[optionIndex].voters) {
      poll.options[optionIndex].voters = poll.options[optionIndex].voters.filter((id: string) => id !== userId);
      await chatRepository.updatePollVotes(conversationId, pollId, poll.options);
    }
  },

  deletePoll: async (requesterId: string, conversationId: string, pollId: string): Promise<void> => {
    const polls = await chatRepository.getPolls(conversationId);
    const poll = polls.find(p => p.pollId === pollId);
    if (!poll) throw new NotFoundError('Bình chọn');
    if (poll.creatorId !== requesterId) throw new ForbiddenError('Chỉ người tạo mới được xóa bình chọn');
    
    await chatRepository.deletePoll(conversationId, pollId);
  },

  // ─── Tasks (Công việc) ───────────────────────────────────────────────

  createTask: async (requesterId: string, conversationId: string, data: any): Promise<void> => {
    const taskId = uuidv4();
    const task = {
      taskId,
      conversationId,
      creatorId: requesterId,
      title: data.title,
      description: data.description,
      assignees: data.assignees || [],
      status: 'todo', // todo, in_progress, done
      dueDate: data.dueDate,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await chatRepository.createTask(task);
  },

  getTasks: async (conversationId: string): Promise<any[]> => {
    return chatRepository.getTasks(conversationId);
  },

  updateTaskStatus: async (conversationId: string, taskId: string, status: string): Promise<void> => {
    await chatRepository.updateTask(conversationId, taskId, { status });
  },

  deleteTask: async (requesterId: string, conversationId: string, taskId: string): Promise<void> => {
    // Logic tương tự deletePoll
    await chatRepository.deleteTask(conversationId, taskId);
  },

  // ─── AI Recap ───────────────────────────────────────────────────────

  generateRecap: async (conversationId: string): Promise<any> => {
    // 1. Lấy tin nhắn gần đây
    const messages = await chatRepository.getMessages(conversationId, 50);
    const text = messages.map(m => `${m.senderId}: ${m.content}`).join('\n');
    
    // 2. Gọi AI (Mock)
    const summaryText = `[AI Tóm tắt]: Cuộc hội thoại xoay quanh việc ${text.length > 0 ? 'trao đổi thông tin dự án' : 'chưa có nội dung mới'}.`;
    
    const summary = {
      summaryId: uuidv4(),
      conversationId,
      content: summaryText,
      createdAt: new Date().toISOString(),
    };
    
    await chatRepository.saveAISummary(conversationId, summary);
    return summary;
  },

  getLatestRecap: async (conversationId: string): Promise<any> => {
    return chatRepository.getLatestAISummary(conversationId);
  },
};
