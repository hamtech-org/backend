import { Request, Response, NextFunction } from 'express';
import { bulletinService } from './bulletin.service.js';
import { sendSuccess } from '@/shared/utils/response.js';

export const bulletinController = {
  getBulletinFeed: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const feed = await bulletinService.getBulletinFeed(req.user!.userId, req.params.groupId);
      sendSuccess(res, feed);
    } catch (error) {
      console.error('[getBulletinFeed]', error);
      next(error);
    }
  },
};
