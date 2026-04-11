import { v4 as uuidv4 } from 'uuid';
import { chatRepository } from './chat.repository.js';
import type { IConversation, IConversationMember, IMessage, ICreateConversationDto, ISendMessageDto } from './chat.types.js';
import { NotFoundError, ForbiddenError } from '@/shared/utils/errors.js';
import { kafkaProducer } from '@/shared/kafka/producer.js';
import { KAFKA_TOPICS } from '@/shared/constants/kafkaTopics.js';
import { userRepository } from '@/modules/user/user.repository.js';

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

export const chatService = {
  // ─── Conversations ────────────────────────────────────────────────────

  getConversations: async (userId: string): Promise<IConversation[]> => {
    const conversations = await chatRepository.getConversations(userId);
    const directConversations = conversations.filter((conversation) => conversation.type === 'direct');

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
          members
            .filter((member) => member.userId !== userId)
            .map((member) => member.userId),
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
    });

    return conversations;
  },

  /**
   * Tạo conversation mới (direct hoặc group).
   * Với direct: kiểm tra đã tồn tại conv 1-1 chưa, nếu có thì trả về conv cũ.
   */
  createConversation: async (creatorId: string, data: ICreateConversationDto): Promise<IConversation> => {
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
    return attachSenderDisplayNames(messages);
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

    // Cập nhật lastMessage trên conversation
    await chatRepository.updateConversationLastMessage(
      conversationId,
      {
        messageId,
        senderId,
        content: data.content,
        type: data.type,
        createdAt: now,
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

    const senders = await userRepository.findByIds([senderId]);
    const senderDisplayName = senders[0]?.displayName ?? null;
    return { ...message, senderDisplayName };
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
};
