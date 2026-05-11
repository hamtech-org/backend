import { v4 as uuidv4 } from 'uuid';
import { conversationRepository } from '../conversation/conversation.repository.js';
import { messageUserHideRepository } from './message-user-hide.repository.js';
import type { IConversation, IMessage, ISendMessageDto } from '../shared/chat.types.js';
import type { MessageStatus } from '@/shared/types/chat.types.js';
import { NotFoundError, ForbiddenError, ValidationError } from '@/shared/utils/errors.js';
import { MAX_PINNED_MESSAGES_PER_CONVERSATION } from '../shared/chat.constants.js';
import { getKafkaProducer } from '@/config/kafka.js';
import { kafkaProducer } from '@/shared/kafka/producer.js';
import { KAFKA_TOPICS } from '@/shared/constants/kafkaTopics.js';
import { logger } from '@/shared/utils/logger.js';
import { userRepository } from '@/modules/user/user.repository.js';
import { mediaService } from '@/modules/media/media.service.js';
import {
  isMessageHiddenFromViewer,
  syncConversationLastMessageMeta,
  attachSenderDisplayNames,
  attachReplyToDetails,
  isConversationNotificationPushMuted,
} from '../shared/chat.helpers.js';

async function emitMessageSearchIndexEvent(payload: {
  action: 'index' | 'delete';
  documentId: string;
  document?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const producer = getKafkaProducer();
    await producer.send({
      topic: KAFKA_TOPICS.SEARCH_INDEX,
      messages: [
        {
          key: payload.documentId,
          value: JSON.stringify({
            action: payload.action,
            indexName: 'messages',
            documentId: payload.documentId,
            document: payload.document ?? null,
          }),
        },
      ],
    });
  } catch (error) {
    logger.warn('[search.index messages] Kafka emit skipped or failed:', error);
  }
}

/**
 * Lấy tin theo PK+SK (nhanh) hoặc Query theo messageId — client có thể gửi `createdAt` hơi lệch
 * so với chuỗi lưu trong SK Dynamo (millis / Z / parse JSON), khiến Get trả null.
 */
async function getMessageForMutation(
  conversationId: string,
  messageId: string,
  createdAt: string,
): Promise<IMessage> {
  const byKey = await conversationRepository.getMessageById(conversationId, messageId, createdAt);
  if (byKey) return byKey;
  const byId = await conversationRepository.findMessageByMessageId(conversationId, messageId);
  if (!byId) throw new NotFoundError('Tin nhắn');
  return byId;
}

function attachPublicMessageStatus(
  conv: IConversation | null,
  viewerUserId: string,
  msg: IMessage,
): IMessage {
  const {
    outboundStatus,
    status: _st,
    readBy,
    ...rest
  } = msg as IMessage & {
    outboundStatus?: MessageStatus;
    status?: MessageStatus;
    readBy?: { userId: string; displayName?: string | null }[];
  };
  const isOwn = msg.senderId === viewerUserId;
  const base = {
    ...rest,
    ...(isOwn && readBy?.length ? { readBy } : {}),
  } as IMessage;
  if (conv?.type === 'direct' && isOwn) {
    return { ...base, status: outboundStatus ?? 'read' };
  }
  if (conv?.type === 'group' && isOwn) {
    return { ...base, status: 'sent' };
  }
  return { ...base, status: 'sent' };
}

/** Ai đã “đọc tới” tin này: lastReadAt của thành viên ≥ createdAt của tin (cùng hội thoại). */
async function attachReadReceipts(
  conversationId: string,
  viewerUserId: string,
  messages: IMessage[],
): Promise<IMessage[]> {
  const members = await conversationRepository.getConversationMembers(conversationId);
  const msgTimes = messages
    .filter((m) => m.senderId === viewerUserId && !m.isRecalled && !m.isDeleted)
    .map((m) => new Date(m.createdAt).getTime());
  if (msgTimes.length === 0) return messages;

  const readerIds = new Set<string>();
  for (const mem of members) {
    if (mem.userId === viewerUserId) continue;
    if (!mem.lastReadAt) continue;
    const t = new Date(mem.lastReadAt).getTime();
    for (const mt of msgTimes) {
      if (t >= mt) readerIds.add(mem.userId);
    }
  }
  if (readerIds.size === 0) return messages;

  const users = await userRepository.findByIds([...readerIds]);
  const userMap = new Map(users.map((u) => [u.userId, u]));

  return messages.map((msg) => {
    if (msg.senderId !== viewerUserId || msg.isRecalled || msg.isDeleted) return msg;
    const readBy = members
      .filter(
        (m) =>
          m.userId !== msg.senderId &&
          !!m.lastReadAt &&
          new Date(m.lastReadAt).getTime() >= new Date(msg.createdAt).getTime(),
      )
      .map((m) => {
        const u = userMap.get(m.userId);
        return { userId: m.userId, displayName: u?.displayName?.trim() ?? null };
      });
    if (readBy.length === 0) return msg;
    return { ...msg, readBy };
  });
}

async function refreshMediaDeliveryForMessage(message: IMessage): Promise<IMessage> {
  if (!message.mediaUrl) return message;
  const resolved = await mediaService.resolveMediaFromAppDownloadUrl(message.mediaUrl);
  if (!resolved) return message;
  return {
    ...message,
    mediaUrl: resolved.mediaUrl,
    mediaType: resolved.mediaType,
    mediaSize: resolved.mediaSize,
    mediaOriginalName: resolved.originalName,
    thumbnailUrl: resolved.thumbnailUrl,
  };
}

async function refreshMediaDeliveryForMessages(messages: IMessage[]): Promise<IMessage[]> {
  return Promise.all(messages.map((m) => refreshMediaDeliveryForMessage(m)));
}

async function refreshReplyMediaDelivery(
  details: IMessage['replyToDetails'],
): Promise<IMessage['replyToDetails']> {
  if (!details?.mediaUrl) return details;
  const resolved = await mediaService.resolveMediaFromAppDownloadUrl(details.mediaUrl);
  if (!resolved) return details;
  return {
    ...details,
    mediaUrl: resolved.mediaUrl,
    thumbnailUrl: resolved.thumbnailUrl,
    mediaType: resolved.mediaType,
  };
}

type SearchIndexAction = 'index' | 'update' | 'delete';

async function emitMessageSearchIndexEvent(
  action: SearchIndexAction,
  payload: {
    messageId: string;
    conversationId: string;
    senderId: string;
    content?: string;
    createdAt?: string;
  },
): Promise<void> {
  const safeContent = String(payload.content ?? '').trim();
  const isIndexLike = action === 'index' || action === 'update';
  await kafkaProducer.send(KAFKA_TOPICS.SEARCH_INDEX, {
    action,
    indexName: 'messages',
    documentId: payload.messageId,
    ...(isIndexLike
      ? {
          document: {
            messageId: payload.messageId,
            conversationId: payload.conversationId,
            senderId: payload.senderId,
            content: safeContent,
            createdAt: payload.createdAt ?? new Date().toISOString(),
          },
        }
      : { document: null }),
  });
}

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
    const conv = await conversationRepository.getConversationById(conversationId);
    const withNames = await attachSenderDisplayNames(filtered);
    const withReply = await attachReplyToDetails(
      conversationId,
      withNames,
      hidden,
      conversationRepository.getMessages,
    );
    const withFreshMedia = await refreshMediaDeliveryForMessages(withReply);
    const withFreshReplyMedia = await Promise.all(
      withFreshMedia.map(async (m) => ({
        ...m,
        replyToDetails: await refreshReplyMediaDelivery(m.replyToDetails ?? null),
      })),
    );
    const withReadBy = await attachReadReceipts(conversationId, viewerUserId, withFreshReplyMedia);
    return withReadBy.map((m) => attachPublicMessageStatus(conv, viewerUserId, m));
  },

  /**
   * Tin trong hội thoại theo người gửi và/hoặc khoảng thời gian (phục vụ tìm kiếm trong panel).
   * Cần ít nhất senderId hoặc cặp from + to (ISO).
   */
  browseMessages: async (
    conversationId: string,
    viewerUserId: string,
    opts: { senderId?: string; from?: string; to?: string; limit?: number },
  ): Promise<IMessage[]> => {
    const member = await conversationRepository.getMember(conversationId, viewerUserId);
    if (!member) throw new ForbiddenError('Bạn không phải thành viên của hội thoại này');

    const senderId = opts.senderId?.trim() || undefined;
    const from = opts.from?.trim() || undefined;
    const to = opts.to?.trim() || undefined;

    if (!senderId && (!from || !to)) {
      throw new ValidationError('Cần senderId hoặc cả hai tham số from và to (ISO 8601)');
    }

    const maxItems = Math.min(Math.max(1, opts.limit ?? 200), 500);

    const raw = await conversationRepository.browseMessages(conversationId, {
      senderId,
      dateFrom: from && to ? from : undefined,
      dateTo: from && to ? to : undefined,
      maxItems,
    });

    const hidden = await messageUserHideRepository.queryHiddenMessageIdsForConversation(
      viewerUserId,
      conversationId,
    );
    const filtered = raw.filter((m) => !isMessageHiddenFromViewer(m, hidden));

    const conv = await conversationRepository.getConversationById(conversationId);
    const withNames = await attachSenderDisplayNames(filtered);
    const withReply = await attachReplyToDetails(
      conversationId,
      withNames,
      hidden,
      conversationRepository.getMessages,
    );
    const withFreshMedia = await refreshMediaDeliveryForMessages(withReply);
    const withFreshReplyMedia = await Promise.all(
      withFreshMedia.map(async (m) => ({
        ...m,
        replyToDetails: await refreshReplyMediaDelivery(m.replyToDetails ?? null),
      })),
    );
    const withReadBy = await attachReadReceipts(conversationId, viewerUserId, withFreshReplyMedia);
    return withReadBy.map((m) => attachPublicMessageStatus(conv, viewerUserId, m));
  },

  /**
   * Lịch sử ảnh/video, file hoặc link trong hội thoại (lọc từ tin gần đây, tối đa ~400 tin).
   */
  getMessageGallery: async (
    conversationId: string,
    viewerUserId: string,
    category: 'media' | 'file' | 'link',
    limit?: number,
  ): Promise<
    Array<{
      messageId: string;
      senderId: string;
      senderDisplayName: string | null;
      type: string;
      content: string;
      mediaUrl: string | null;
      mediaType: string | null;
      thumbnailUrl: string | null;
      mediaOriginalName: string | null;
      createdAt: string;
    }>
  > => {
    const member = await conversationRepository.getMember(conversationId, viewerUserId);
    if (!member) throw new ForbiddenError('Bạn không phải thành viên của hội thoại này');

    const maxOut = Math.min(Math.max(1, limit ?? 80), 200);
    const fetchLimit = Math.min(400, Math.max(maxOut * 4, 120));
    const raw = await conversationRepository.getMessages(conversationId, fetchLimit);
    const hidden = await messageUserHideRepository.queryHiddenMessageIdsForConversation(
      viewerUserId,
      conversationId,
    );
    const visible = raw.filter((m) => !isMessageHiddenFromViewer(m, hidden));

    const isRecalledOrDeleted = (m: IMessage) => m.isRecalled || m.isDeleted;

    const mime = (m: IMessage) => (m.mediaType ?? '').toLowerCase();
    const isMedia = (m: IMessage) => {
      if (isRecalledOrDeleted(m)) return false;
      if (m.type === 'sticker' || m.type === 'emoji') return false;
      if (m.type === 'image' || m.type === 'video') return true;
      const mt = mime(m);
      if (m.mediaUrl && (mt.startsWith('image/') || mt.startsWith('video/'))) return true;
      return false;
    };
    const isFile = (m: IMessage) => {
      if (isRecalledOrDeleted(m)) return false;
      if (m.type === 'file') return true;
      const mt = mime(m);
      if (!m.mediaUrl || !mt) return false;
      if (mt.startsWith('image/') || mt.startsWith('video/')) return false;
      return true;
    };
    const systemJson = (content: string) => {
      const t = content.trim();
      if (!t.startsWith('{')) return false;
      try {
        const o = JSON.parse(t) as { kind?: string };
        return o && typeof o === 'object' && typeof o.kind === 'string';
      } catch {
        return false;
      }
    };
    const firstUrl = (content: string): string => {
      const lines = content.split(/\r?\n/).map((l) => l.trim());
      for (const line of lines) {
        if (/^https?:\/\//i.test(line)) return line.slice(0, 800);
      }
      const match = content.match(/https?:\/\/[^\s<>"']+/i);
      return match ? match[0].slice(0, 800) : content.trim().slice(0, 200);
    };
    const isLink = (m: IMessage) => {
      if (isRecalledOrDeleted(m)) return false;
      if (m.type !== 'text') return false;
      const c = m.content ?? '';
      if (!c.trim() || systemJson(c)) return false;
      return /^https?:\/\//i.test(c.trim()) || /https?:\/\/[^\s<>"']+/i.test(c);
    };

    let picked: IMessage[];
    if (category === 'media') picked = visible.filter(isMedia);
    else if (category === 'file') picked = visible.filter(isFile);
    else picked = visible.filter(isLink);

    picked = picked.slice(0, maxOut);
    const withNames = await attachSenderDisplayNames(picked);

    const withFreshMedia = await refreshMediaDeliveryForMessages(withNames);
    return withFreshMedia.map((m) => {
      const content =
        category === 'link' ? firstUrl(m.content ?? '') : (m.content ?? '').slice(0, 200);
      return {
        messageId: m.messageId,
        senderId: m.senderId,
        senderDisplayName: m.senderDisplayName ?? null,
        type: String(m.type),
        content,
        mediaUrl: m.mediaUrl ?? null,
        mediaType: m.mediaType ?? null,
        thumbnailUrl: m.thumbnailUrl ?? null,
        mediaOriginalName: m.mediaOriginalName ?? null,
        createdAt: m.createdAt,
      };
    });
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

    let mediaUrl: string | null = null;
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
    } else if (data.mediaUrl) {
      const forwarded = await mediaService.resolveMediaFromAppDownloadUrl(data.mediaUrl);
      if (forwarded) {
        mediaUrl = forwarded.mediaUrl;
        mediaType = forwarded.mediaType;
        mediaSize = forwarded.mediaSize;
        mediaOriginalName = forwarded.originalName;
        thumbnailUrl = forwarded.thumbnailUrl;
      } else {
        mediaUrl = data.mediaUrl;
      }
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
      ...(conversation.type === 'direct' ? { outboundStatus: 'sent' as MessageStatus } : {}),
    };

    await conversationRepository.createMessage(message);

    void emitMessageSearchIndexEvent({
      action: 'index',
      documentId: messageId,
      document: {
        messageId,
        conversationId,
        senderId,
        conversationType: conversation.type,
        content: (message.content ?? '').slice(0, 500),
        createdAt: now,
      },
    });

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
    const [messageWithFreshMedia] = await refreshMediaDeliveryForMessages([messageForClient]);
    const finalMessageForClient: IMessage = {
      ...messageWithFreshMedia,
      replyToDetails: await refreshReplyMediaDelivery(messageWithFreshMedia.replyToDetails ?? null),
    };

    const lastPreviewContent =
      message.content.trim() !== ''
        ? message.content.trim()
        : message.type === 'image'
          ? '[Ảnh]'
          : message.type === 'video'
            ? '[Video]'
            : message.type === 'file'
              ? message.mediaOriginalName?.trim() || '[File]'
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

    // Push notification (FCM/APNs…): chỉ gửi tới thành viên **chưa** tắt thông báo (giống Zalo).
    // Tin vẫn lưu DB; socket `message:new` vẫn tới mọi thành viên (xem chat.broadcast).
    const pushRecipientIds = otherMembers
      .filter((m) => !isConversationNotificationPushMuted(m))
      .map((m) => m.userId);

    await Promise.all([
      // Tăng unread cho members khác
      ...otherMembers.map((m) =>
        conversationRepository.updateMemberUnreadCount(conversationId, m.userId, 1),
      ),
      kafkaProducer.send(KAFKA_TOPICS.NOTIFICATION_EVENTS, {
        type: 'NEW_MESSAGE',
        payload: {
          conversationId,
          senderId,
          messageId,
          messagePreview: lastPreviewContent.slice(0, 100),
          recipientIds: pushRecipientIds,
        },
      }),
      emitMessageSearchIndexEvent('index', {
        messageId,
        conversationId,
        senderId,
        content: lastPreviewContent,
        createdAt: now,
      }),
    ]);

    const {
      outboundStatus: _ob,
      status: _s,
      ...restOut
    } = finalMessageForClient as IMessage & {
      outboundStatus?: MessageStatus;
      status?: MessageStatus;
    };
    return { ...restOut, status: 'sent' as MessageStatus };
  },

  /**
   * Chat 1-1: người nhận xác nhận tin đã tới thiết bị (ACK delivered).
   */
  markOutboundDelivered: async (
    conversationId: string,
    recipientUserId: string,
    messageId: string,
  ): Promise<{ senderId: string } | null> => {
    const conv = await conversationRepository.getConversationById(conversationId);
    if (!conv || conv.type !== 'direct') return null;

    const msg = await conversationRepository.findMessageByMessageId(conversationId, messageId);
    if (!msg || msg.senderId === recipientUserId) return null;
    if (msg.outboundStatus === 'read' || msg.outboundStatus === 'delivered') return null;

    const sortKey = `MSG#${msg.createdAt}#${msg.messageId}`;
    await conversationRepository.updateMessage(conversationId, messageId, sortKey, {
      outboundStatus: 'delivered',
    });
    return { senderId: msg.senderId };
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
    const message = await getMessageForMutation(conversationId, messageId, createdAt);
    if (message.senderId !== senderId) throw new ForbiddenError('Chỉ người gửi mới được chỉnh sửa');
    if (message.type !== 'text') {
      throw new ForbiddenError('Chỉ có thể sửa tin nhắn dạng chữ');
    }

    const sortKey = `MSG#${message.createdAt}#${messageId}`;
    await conversationRepository.updateMessage(conversationId, messageId, sortKey, {
      content,
      isEdited: true,
    });
    await emitMessageSearchIndexEvent('update', {
      messageId,
      conversationId,
      senderId,
      content,
      createdAt: message.createdAt,
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
    await getMessageForMutation(conversationId, messageId, createdAt);
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
    const message = await getMessageForMutation(conversationId, messageId, createdAt);
    if (message.senderId !== senderId) throw new ForbiddenError('Chỉ người gửi mới được thu hồi');

    const wasPinned = message.isPinned;
    const sortKey = `MSG#${message.createdAt}#${messageId}`;
    await conversationRepository.updateMessage(conversationId, messageId, sortKey, {
      isRecalled: true,
      content: 'Tin nhắn đã được thu hồi',
      isPinned: false,
    });
    await emitMessageSearchIndexEvent('delete', {
      messageId,
      conversationId,
      senderId,
      createdAt: message.createdAt,
    });
    if (wasPinned) {
      await conversationRepository.adjustPinnedMessageCount(conversationId, -1);
    }
    await syncConversationLastMessageMeta(conversationId, {
      getMessages: conversationRepository.getMessages,
      updateConversationLastMessage: conversationRepository.updateConversationLastMessage,
      clearConversationLastMessage: conversationRepository.clearConversationLastMessage,
    });

    void emitMessageSearchIndexEvent({ action: 'delete', documentId: messageId });
  },

  /**
   * Đánh dấu tin nhắn đã đọc, reset unreadCount.
   */
  markAsRead: async (conversationId: string, userId: string, messageId: string): Promise<void> => {
    await Promise.all([
      conversationRepository.updateMessageStatus(messageId, userId, 'read'),
      conversationRepository.resetMemberUnreadCount(conversationId, userId),
    ]);

    const conv = await conversationRepository.getConversationById(conversationId);
    if (!conv || conv.type !== 'direct') return;

    const pivot = await conversationRepository.findMessageByMessageId(conversationId, messageId);
    if (!pivot) return;

    const members = await conversationRepository.getConversationMembers(conversationId);
    const partnerId = members.find((m) => m.userId !== userId)?.userId;
    if (!partnerId) return;

    const pivotMs = new Date(pivot.createdAt).getTime();
    const recent = await conversationRepository.getMessages(conversationId, 100);

    await Promise.all(
      recent.map(async (m) => {
        if (m.senderId !== partnerId) return;
        if (m.isRecalled || m.isDeleted) return;
        if (new Date(m.createdAt).getTime() > pivotMs) return;
        if (m.outboundStatus === 'read') return;
        const sortKey = `MSG#${m.createdAt}#${m.messageId}`;
        await conversationRepository.updateMessage(conversationId, m.messageId, sortKey, {
          outboundStatus: 'read',
        });
      }),
    );
  },

  // ─── Ghim / Bỏ ghim ──────────────────────────────────────────────────

  pinMessage: async (
    messageId: string,
    conversationId: string,
    createdAt: string,
  ): Promise<void> => {
    const message = await getMessageForMutation(conversationId, messageId, createdAt);
    if (message.isPinned) return;

    const convMeta = await conversationRepository.getConversationById(conversationId);
    const pinnedCount =
      typeof convMeta?.pinnedMessageCount === 'number' ? convMeta.pinnedMessageCount : 0;
    if (pinnedCount >= MAX_PINNED_MESSAGES_PER_CONVERSATION) {
      throw new ForbiddenError(
        `Tối đa ${MAX_PINNED_MESSAGES_PER_CONVERSATION} tin ghim trong cuộc trò chuyện.`,
      );
    }

    const sortKey = `MSG#${message.createdAt}#${messageId}`;
    await conversationRepository.updateMessage(conversationId, messageId, sortKey, {
      isPinned: true,
    });
    await conversationRepository.adjustPinnedMessageCount(conversationId, 1);
  },

  unpinMessage: async (
    messageId: string,
    conversationId: string,
    createdAt: string,
  ): Promise<void> => {
    const message = await getMessageForMutation(conversationId, messageId, createdAt);
    if (!message.isPinned) return;

    const sortKey = `MSG#${message.createdAt}#${messageId}`;
    await conversationRepository.updateMessage(conversationId, messageId, sortKey, {
      isPinned: false,
    });
    await conversationRepository.adjustPinnedMessageCount(conversationId, -1);
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
    const message = await getMessageForMutation(conversationId, messageId, createdAt);

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
