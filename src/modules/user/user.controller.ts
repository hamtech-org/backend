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
      sendSuccess(res, profile);
    } catch (error) { next(error); }
  },
};
