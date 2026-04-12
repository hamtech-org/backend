import { v4 as uuidv4 } from 'uuid';
import { chatRepository } from './chat.repository.js';
import type {
  IConversation,
  IConversationMember,
  IMessage,
  ICreateConversationDto,
  ISendMessageDto,
  ILastMessage,
} from './chat.types.js';
import { NotFoundError, ForbiddenError } from '@/shared/utils/errors.js';
import { kafkaProducer } from '@/shared/kafka/producer.js';
import { KAFKA_TOPICS } from '@/shared/constants/kafkaTopics.js';
import { userRepository } from '@/modules/user/user.repository.js';

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
      conversation.avatar = otherUser.avatar ?? null;
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
      name: data.name ?? null,
      avatar: null,
      creatorId,
      lastMessage: null,
      lastMessageAt: null,
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
          lastReadAt: null,
          unreadCount: 0,
          isMuted: false,
          nickname: null,
        };
        return chatRepository.addConversationMember(member);
      }),
    );

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

    const message: IMessage = {
      messageId,
      conversationId,
      senderId,
      type: data.type,
      content: data.content,
      encryptedContent: null,
      mediaUrl: data.mediaUrl ?? null,
      mediaType: null,
      mediaSize: null,
      thumbnailUrl: null,
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

    // Cập nhật lastMessage trên conversation
    await chatRepository.updateConversationLastMessage(
      conversationId,
      {
        messageId,
        senderId,
        content: data.content,
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
          messagePreview: data.content.slice(0, 100),
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
};
