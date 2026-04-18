import { v4 as uuidv4 } from 'uuid';
import { conversationRepository } from '../conversation/conversation.repository.js';
import { messageUserHideRepository } from './message-user-hide.repository.js';
import type {
  IMessage,
  ISendMessageDto,
} from '../shared/chat.types.js';
import { NotFoundError, ForbiddenError } from '@/shared/utils/errors.js';
import { kafkaProducer } from '@/shared/kafka/producer.js';
import { KAFKA_TOPICS } from '@/shared/constants/kafkaTopics.js';
import { userRepository } from '@/modules/user/user.repository.js';
import { mediaService } from '@/modules/media/media.service.js';
import {
  isMessageHiddenFromViewer,
  syncConversationLastMessageMeta,
  attachSenderDisplayNames,
  attachReplyToDetails,
} from '../shared/chat.helpers.js';

export const messageService = {
  getMessages: async (
    conversationId: string,
    viewerUserId: string,
    limit?: number,
  ): Promise<IMessage[]> => {
    const member = await conversationRepository.getMember(conversationId, viewerUserId);
    if (!member) throw new ForbiddenError('Bạn không phải thành viên của hội thoại này');

    const effectiveLimit = limit ?? 20;
    // Lấy gấp đôi rồi lọc ẩn-theo-user để giảm lỗ hổng phân trang (Dynamo Limit áp trước khi lọc).
    const fetchLimit = Math.min(Math.max(effectiveLimit * 2, effectiveLimit), 100);
    const raw = await conversationRepository.getMessages(conversationId, fetchLimit);
    const hidden = await messageUserHideRepository.queryHiddenMessageIdsForConversation(
      viewerUserId,
      conversationId,
    );
    const filtered = raw
      .filter((m) => !isMessageHiddenFromViewer(m, hidden))
      .slice(0, effectiveLimit);
    const withNames = await attachSenderDisplayNames(filtered);
    return attachReplyToDetails(conversationId, withNames, hidden, conversationRepository.getMessages);
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
    const conversation = await conversationRepository.getConversationById(conversationId);
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

    await conversationRepository.createMessage(message);

    const senders = await userRepository.findByIds([senderId]);
    const senderDisplayName = senders[0]?.displayName?.trim() ?? null;

    const withSenderName: IMessage = { ...message, senderDisplayName };
    const hiddenForSender = await messageUserHideRepository.queryHiddenMessageIdsForConversation(
      senderId,
      conversationId,
    );
    const [messageForClient] = await attachReplyToDetails(
      conversationId,
      [withSenderName],
      hiddenForSender,
      conversationRepository.getMessages,
    );

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
    await conversationRepository.updateConversationLastMessage(
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
    const members = await conversationRepository.getConversationMembers(conversationId);
    const otherMembers = members.filter((m) => m.userId !== senderId);

    await Promise.all([
      // Tăng unread cho members khác
      ...otherMembers.map((m) =>
        conversationRepository.updateMemberUnreadCount(conversationId, m.userId, 1),
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
    const message = await conversationRepository.getMessageById(conversationId, messageId, createdAt);
    if (!message) throw new NotFoundError('Tin nhắn');
    if (message.senderId !== senderId) throw new ForbiddenError('Chỉ người gửi mới được chỉnh sửa');
    if (message.type !== 'text') {
      throw new ForbiddenError('Chỉ có thể sửa tin nhắn dạng chữ');
    }

    const sortKey = `MSG#${message.createdAt}#${messageId}`;
    await conversationRepository.updateMessage(conversationId, messageId, sortKey, {
      content,
      isEdited: true,
    });
    await syncConversationLastMessageMeta(conversationId, {
      getMessages: conversationRepository.getMessages,
      updateConversationLastMessage: conversationRepository.updateConversationLastMessage,
      clearConversationLastMessage: conversationRepository.clearConversationLastMessage,
    });
  },

  /**
   * Ẩn tin nhắn chỉ phía user đang gọi (không sửa bản ghi message, không broadcast phòng).
   */
  deleteMessage: async (
    messageId: string,
    userId: string,
    conversationId: string,
    createdAt: string,
  ): Promise<void> => {
    const message = await conversationRepository.getMessageById(conversationId, messageId, createdAt);
    if (!message) throw new NotFoundError('Tin nhắn');
    const member = await conversationRepository.getMember(conversationId, userId);
    if (!member) throw new ForbiddenError('Bạn không phải thành viên của hội thoại này');

    await messageUserHideRepository.putHide(userId, conversationId, messageId);
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
    const message = await conversationRepository.getMessageById(conversationId, messageId, createdAt);
    if (!message) throw new NotFoundError('Tin nhắn');
    if (message.senderId !== senderId) throw new ForbiddenError('Chỉ người gửi mới được thu hồi');

    const sortKey = `MSG#${message.createdAt}#${messageId}`;
    await conversationRepository.updateMessage(conversationId, messageId, sortKey, {
      isRecalled: true,
      content: 'Tin nhắn đã được thu hồi',
      isPinned: false,
    });
    await syncConversationLastMessageMeta(conversationId, {
      getMessages: conversationRepository.getMessages,
      updateConversationLastMessage: conversationRepository.updateConversationLastMessage,
      clearConversationLastMessage: conversationRepository.clearConversationLastMessage,
    });
  },

  /**
   * Đánh dấu tin nhắn đã đọc, reset unreadCount.
   */
  markAsRead: async (conversationId: string, userId: string, messageId: string): Promise<void> => {
    await Promise.all([
      conversationRepository.updateMessageStatus(messageId, userId, 'read'),
      conversationRepository.resetMemberUnreadCount(conversationId, userId),
    ]);
  },

  // ─── Ghim / Bỏ ghim ──────────────────────────────────────────────────

  pinMessage: async (
    messageId: string,
    conversationId: string,
    createdAt: string,
  ): Promise<void> => {
    const sortKey = `MSG#${createdAt}#${messageId}`;
    await conversationRepository.updateMessage(conversationId, messageId, sortKey, {
      isPinned: true,
    });
  },

  unpinMessage: async (
    messageId: string,
    conversationId: string,
    createdAt: string,
  ): Promise<void> => {
    const sortKey = `MSG#${createdAt}#${messageId}`;
    await conversationRepository.updateMessage(conversationId, messageId, sortKey, {
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
    const message = await conversationRepository.getMessageById(conversationId, messageId, createdAt);
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
    await conversationRepository.updateMessage(conversationId, messageId, sortKey, {
      reactions,
    });

    return reactions;
  },
};
