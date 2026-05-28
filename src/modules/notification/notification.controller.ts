import { Request, Response, NextFunction } from 'express';
import { notificationService } from './notification.service.js';
import { deviceTokenRepository } from './device-token.repository.js';
import { sendSuccess } from '@/shared/utils/response.js';
import type { PushPlatform } from './notification.types.js';

export const notificationController = {
  list: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const items = await notificationService.getNotifications(req.user!.userId, limit);
      const unreadCount = await notificationService.getUnreadCount(req.user!.userId);
      sendSuccess(res, { items, unreadCount }, 'Lấy thông báo thành công');
    } catch (error) {
      next(error);
    }
  },

  unreadCount: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const unreadCount = await notificationService.getUnreadCount(req.user!.userId);
      sendSuccess(res, { unreadCount }, 'OK');
    } catch (error) {
      next(error);
    }
  },

  markRead: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await notificationService.markAsRead(req.user!.userId, req.params.notificationId);
      sendSuccess(res, null, 'Đã đánh dấu đã đọc');
    } catch (error) {
      next(error);
    }
  },

  markAllRead: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const count = await notificationService.markAllAsRead(req.user!.userId);
      sendSuccess(res, { count }, 'Đã đánh dấu tất cả đã đọc');
    } catch (error) {
      next(error);
    }
  },

  registerDeviceToken: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token, platform } = req.body as { token: string; platform: PushPlatform };
      await deviceTokenRepository.upsert(req.user!.userId, token, platform);
      sendSuccess(res, null, 'Đăng ký thiết bị thành công');
    } catch (error) {
      next(error);
    }
  },

  removeDeviceToken: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token } = req.body as { token: string };
      await deviceTokenRepository.remove(req.user!.userId, token);
      sendSuccess(res, null, 'Đã hủy đăng ký thiết bị');
    } catch (error) {
      next(error);
    }
  },
};
