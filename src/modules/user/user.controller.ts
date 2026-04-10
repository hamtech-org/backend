import { Request, Response, NextFunction } from 'express';
import { userService } from './user.service.js';
import { sendSuccess } from '@/shared/utils/response.js';
import { NotFoundError } from '@/shared/utils/errors.js';

export const userController = {
  getProfile: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await userService.getUserById(req.user!.userId);
      if (!user) throw new NotFoundError('Người dùng');
      sendSuccess(res, user, 'Lấy thông tin thành công');
    } catch (error) { next(error); }
  },

  updateProfile: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const updated = await userService.updateProfile(req.user!.userId, req.body);
      sendSuccess(res, updated, 'Cập nhật thành công');
    } catch (error) { next(error); }
  },

  getUserById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const profile = await userService.getPublicProfile(req.params.userId);
      sendSuccess(res, profile, 'Lấy thông tin thành công');
    } catch (error) { next(error); }
  },

  searchUsers: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { q, limit = '10', offset = '0' } = req.query as { q?: string; limit?: string; offset?: string };
      if (!q) {
        res.status(400).json({ error: 'Query parameter "q" is required' });
        return;
      }
      const results = await userService.searchUsers(q, parseInt(limit) || 10, parseInt(offset) || 0);
      sendSuccess(res, results, 'Tìm kiếm thành công');
    } catch (error) { next(error); }
  },

  getMultipleUsers: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userIds } = req.body as { userIds: string[] };
      if (!Array.isArray(userIds) || userIds.length === 0) {
        res.status(400).json({ error: 'userIds array is required and cannot be empty' });
        return;
      }
      const users = await userService.getMultipleUsers(userIds);
      sendSuccess(res, users, 'Lấy thông tin thành công');
    } catch (error) { next(error); }
  },
};
