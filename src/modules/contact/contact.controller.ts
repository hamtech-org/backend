import { Request, Response, NextFunction } from 'express';
import { contactService } from './contact.service.js';
import { sendSuccess, sendCreated } from '@/shared/utils/response.js';

export const contactController = {
  getFriends: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const friends = await contactService.getFriends(req.user!.userId);
      sendSuccess(res, friends);
    } catch (error) {
      next(error);
    }
  },

  removeFriend: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await contactService.removeFriend(req.user!.userId, req.params.friendId);
      sendSuccess(res, null, 'Hủy kết bạn thành công');
    } catch (error) {
      next(error);
    }
  },

  getGroups: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groups = await contactService.getGroups(req.user!.userId);
      sendSuccess(res, groups);
    } catch (error) {
      next(error);
    }
  },

  createGroup: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const group = await contactService.createGroup(req.user!.userId, req.body);
      sendCreated(res, group);
    } catch (error) {
      next(error);
    }
  },
};
