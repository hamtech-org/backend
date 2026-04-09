import { Request, Response, NextFunction } from 'express';
import { adminService } from './admin.service.js';
import { sendSuccess } from '@/shared/utils/response.js';
import type { IModerateAction, MetricType } from './admin.types.js';

export const adminController = {
  getGroups: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const groups = await adminService.getGroups(limit);
      sendSuccess(res, groups);
    } catch (error) { next(error); }
  },

  moderateGroup: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await adminService.moderateGroup(req.user!.userId, req.params.groupId, req.body as IModerateAction);
      sendSuccess(res, null, 'Xử lý nhóm thành công');
    } catch (error) { next(error); }
  },

  getPosts: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const posts = await adminService.getPosts(limit);
      sendSuccess(res, posts);
    } catch (error) { next(error); }
  },

  moderatePost: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await adminService.moderatePost(req.user!.userId, req.params.postId, req.body as IModerateAction);
      sendSuccess(res, null, 'Xử lý bài viết thành công');
    } catch (error) { next(error); }
  },

  deletePost: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { reason } = req.body as { reason: string };
      await adminService.deletePost(req.user!.userId, req.params.postId, reason);
      sendSuccess(res, null, 'Xóa bài viết thành công');
    } catch (error) { next(error); }
  },

  getAnalytics: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const metricType = req.params.metricType as MetricType;
      const { from, to } = req.query as { from?: string; to?: string };
      const analytics = await adminService.getAnalytics(metricType, from, to);
      sendSuccess(res, analytics);
    } catch (error) { next(error); }
  },

  getResourceSummary: async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const summary = await adminService.getResourceSummary();
      sendSuccess(res, summary);
    } catch (error) { next(error); }
  },
};
