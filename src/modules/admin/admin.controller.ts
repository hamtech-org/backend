import { Request, Response, NextFunction } from 'express';
import { adminService } from './admin.service.js';
import { sendSuccess } from '@/shared/utils/response.js';
import type { IAdminAnalyticsDashboardQuery, MetricType } from './admin.types.js';
import type { AdminListQuery } from './admin.crud.types.js';
import { adminAnalyticsDashboardService } from './admin.analytics.dashboard.service.js';

function parseListQuery(req: Request): AdminListQuery {
  return {
    query: typeof req.query.query === 'string' ? req.query.query : undefined,
    role: req.query.role === 'admin' || req.query.role === 'user' ? req.query.role : undefined,
    status:
      typeof req.query.status === 'string'
        ? (req.query.status as AdminListQuery['status'])
        : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
  };
}

export const adminController = {
  listUsers: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await adminService.listUsers(parseListQuery(req));
      sendSuccess(res, data);
    } catch (error) {
      next(error);
    }
  },

  getUser: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await adminService.getUser(req.params.userId);
      sendSuccess(res, user);
    } catch (error) {
      next(error);
    }
  },

  createUser: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await adminService.createUser(req.user!.userId, req.body);
      sendSuccess(res, user, 'Tạo người dùng thành công', 201);
    } catch (error) {
      next(error);
    }
  },

  updateUser: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await adminService.updateUser(req.user!.userId, req.params.userId, req.body);
      sendSuccess(res, user, 'Cập nhật người dùng thành công');
    } catch (error) {
      next(error);
    }
  },

  updateUserRole: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await adminService.updateUserRole(
        req.user!.userId,
        req.params.userId,
        req.body.role,
      );
      sendSuccess(res, user, 'Cập nhật quyền thành công');
    } catch (error) {
      next(error);
    }
  },

  deleteUser: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await adminService.deleteUser(req.user!.userId, req.params.userId);
      sendSuccess(res, null, 'Xóa người dùng thành công');
    } catch (error) {
      next(error);
    }
  },

  listGroups: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await adminService.listGroups(parseListQuery(req));
      sendSuccess(res, data);
    } catch (error) {
      next(error);
    }
  },

  getGroup: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const group = await adminService.getGroup(req.params.groupId);
      sendSuccess(res, group);
    } catch (error) {
      next(error);
    }
  },

  createGroup: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const group = await adminService.createGroup(req.user!.userId, req.body);
      sendSuccess(res, group, 'Tạo nhóm thành công', 201);
    } catch (error) {
      next(error);
    }
  },

  updateGroup: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const group = await adminService.updateGroup(req.user!.userId, req.params.groupId, req.body);
      sendSuccess(res, group, 'Cập nhật nhóm thành công');
    } catch (error) {
      next(error);
    }
  },

  deleteGroup: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await adminService.deleteGroup(req.user!.userId, req.params.groupId);
      sendSuccess(res, null, 'Xóa nhóm thành công');
    } catch (error) {
      next(error);
    }
  },

  listPosts: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await adminService.listPosts(parseListQuery(req));
      sendSuccess(res, data);
    } catch (error) {
      next(error);
    }
  },

  getPost: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const post = await adminService.getPost(req.params.postId);
      sendSuccess(res, post);
    } catch (error) {
      next(error);
    }
  },

  createPost: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const post = await adminService.createPost(req.user!.userId, req.body);
      sendSuccess(res, post, 'Tạo bài viết thành công', 201);
    } catch (error) {
      next(error);
    }
  },

  updatePost: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const post = await adminService.updatePost(req.user!.userId, req.params.postId, req.body);
      sendSuccess(res, post, 'Cập nhật bài viết thành công');
    } catch (error) {
      next(error);
    }
  },

  deletePost: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await adminService.deletePost(req.user!.userId, req.params.postId);
      sendSuccess(res, null, 'Xóa bài viết thành công');
    } catch (error) {
      next(error);
    }
  },

  getAnalytics: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const path = req.path;
      let metricType: MetricType = 'users';
      if (path.includes('/engagement')) metricType = 'engagement';
      else if (path.includes('/posts')) metricType = 'posts';
      else if (path.includes('/groups')) metricType = 'groups';

      const { from, to } = req.query as { from?: string; to?: string };
      const analytics = await adminService.getAnalytics(metricType, from, to);
      sendSuccess(res, analytics);
    } catch (error) {
      next(error);
    }
  },

  getAnalyticsDashboard: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = req.query as unknown as IAdminAnalyticsDashboardQuery;
      const data = await adminAnalyticsDashboardService.getDashboard(q);
      sendSuccess(res, data);
    } catch (error) {
      next(error);
    }
  },

  getResourceSummary: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
      const summary = await adminService.getResourceSummary(forceRefresh);
      sendSuccess(res, summary);
    } catch (error) {
      next(error);
    }
  },
};
