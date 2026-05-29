import { v4 as uuidv4 } from 'uuid';
import { getIO } from '@/socket/index.js';
import { logger } from '@/shared/utils/logger.js';
import { notificationRepository } from './notification.repository.js';
import { sendExpoPushToUser } from './notification.push.js';
import type {
  INotification,
  INotificationEvent,
  INotificationKafkaMessage,
} from './notification.types.js';

function emitNotificationSocket(
  userId: string,
  notification: INotification,
  unreadCount: number,
): void {
  try {
    const io = getIO();
    io.to(`user:${userId}`).emit('notification:new', { notification, unreadCount });
    io.to(`user:${userId}`).emit('notification:unread_count', { unreadCount });
  } catch (error) {
    logger.warn('emitNotificationSocket failed:', error);
  }
}

export const notificationService = {
  getNotifications: async (userId: string, limit?: number): Promise<INotification[]> => {
    return notificationRepository.getByUserId(userId, limit ?? 50);
  },

  getUnreadCount: async (userId: string): Promise<number> => {
    return notificationRepository.getUnreadCount(userId);
  },

  markAsRead: async (userId: string, notificationId: string): Promise<void> => {
    await notificationRepository.markAsRead(userId, notificationId);
    const unreadCount = await notificationRepository.getUnreadCount(userId);
    try {
      getIO().to(`user:${userId}`).emit('notification:unread_count', { unreadCount });
    } catch {
      /* socket optional */
    }
  },

  markAllAsRead: async (userId: string): Promise<number> => {
    const count = await notificationRepository.markAllAsRead(userId);
    try {
      getIO().to(`user:${userId}`).emit('notification:unread_count', { unreadCount: 0 });
    } catch {
      /* socket optional */
    }
    return count;
  },

  /** Tạo bản ghi + socket + push (một người nhận). */
  dispatch: async (event: INotificationEvent): Promise<INotification> => {
    const now = new Date().toISOString();
    const notification: INotification = {
      notificationId: uuidv4(),
      userId: event.userId,
      type: event.type,
      title: event.title,
      body: event.body,
      data: event.data,
      isRead: false,
      createdAt: now,
      expiresAt: null,
    };

    const saved = await notificationRepository.create(notification);
    const unreadCount = await notificationRepository.getUnreadCount(event.userId);
    emitNotificationSocket(event.userId, saved, unreadCount);

    if (!event.skipPush) {
      await sendExpoPushToUser(event.userId, event.title, event.body, event.data);
    }

    return saved;
  },

  /** Kafka consumer / batch message handler. */
  processKafkaMessage: async (raw: Record<string, unknown>): Promise<void> => {
    if (raw.type === 'message' && Array.isArray(raw.recipientIds)) {
      const batch = raw as unknown as INotificationKafkaMessage;
      await Promise.all(
        batch.recipientIds.map((userId) =>
          notificationService.dispatch({
            type: 'message',
            userId,
            title: batch.title,
            body: batch.body,
            data: batch.data,
            skipPush: batch.skipPush,
          }),
        ),
      );
      return;
    }

    if (raw.type === 'NEW_MESSAGE' && raw.payload && typeof raw.payload === 'object') {
      const payload = raw.payload as {
        recipientIds?: string[];
        conversationId?: string;
        senderId?: string;
        messageId?: string;
        messagePreview?: string;
        senderName?: string;
      };
      const recipientIds = payload.recipientIds ?? [];
      if (recipientIds.length === 0) return;

      const title = String(payload.senderName ?? 'Tin nhắn mới');
      const body = String(payload.messagePreview ?? 'Bạn có tin nhắn mới');
      const conversationId = String(payload.conversationId ?? '');

      await Promise.all(
        recipientIds.map((userId) =>
          notificationService.dispatch({
            type: 'message',
            userId,
            title,
            body,
            data: {
              route: 'chat',
              id: conversationId,
              entityType: 'chat',
              entityId: conversationId,
              deepLink: `/chat/${conversationId}`,
              actorId: payload.senderId,
              actorName: payload.senderName,
              senderId: payload.senderId,
              senderName: payload.senderName,
              messageId: payload.messageId,
              messagePreview: body,
              extra: {
                messageId: payload.messageId,
                senderId: payload.senderId,
                senderName: payload.senderName,
                actorId: payload.senderId,
                actorName: payload.senderName,
                messagePreview: body,
              },
            },
          }),
        ),
      );
      return;
    }

    const event = raw as unknown as INotificationEvent;
    if (event.userId && event.type && event.title) {
      await notificationService.dispatch(event);
    }
  },

  processNotificationEvent: async (event: INotificationEvent): Promise<void> => {
    await notificationService.dispatch(event);
  },

  sendPushNotification: async (event: INotificationEvent): Promise<void> => {
    await sendExpoPushToUser(event.userId, event.title, event.body, event.data);
  },

  sendEmailNotification: async (
    _userId: string,
    _subject: string,
    _body: string,
  ): Promise<void> => {
    logger.debug('sendEmailNotification: chưa triển khai SES');
  },
};
