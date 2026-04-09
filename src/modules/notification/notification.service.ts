import { notificationRepository } from './notification.repository.js';
import type { INotification, INotificationEvent } from './notification.types.js';

export const notificationService = {
  getNotifications: async (userId: string, limit?: number): Promise<INotification[]> => {
    return notificationRepository.getByUserId(userId, limit);
  },

  markAsRead: async (_userId: string, _notificationId: string): Promise<void> => {
    // TODO: Tìm notification theo id, cập nhật isRead = true
    throw new Error('Chưa triển khai');
  },

  markAllAsRead: async (_userId: string): Promise<void> => {
    // TODO: Đánh dấu tất cả notification của user là đã đọc
    throw new Error('Chưa triển khai');
  },

  sendPushNotification: async (_event: INotificationEvent): Promise<void> => {
    // TODO: Gửi push notification qua FCM/APNs + emit socket event
    throw new Error('Chưa triển khai');
  },

  sendEmailNotification: async (_userId: string, _subject: string, _body: string): Promise<void> => {
    // TODO: Gửi email qua AWS SES
    throw new Error('Chưa triển khai');
  },

  processNotificationEvent: async (event: INotificationEvent): Promise<void> => {
    // TODO: Tạo notification record + gửi push + gửi email nếu cần
    void notificationRepository;
    void event;
    throw new Error('Chưa triển khai');
  },
};
