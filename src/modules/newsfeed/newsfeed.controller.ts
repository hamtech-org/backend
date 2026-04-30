import { Request, Response, NextFunction } from 'express';
import { newsfeedService } from './newsfeed.service.js';
import { sendSuccess, sendCreated } from '@/shared/utils/response.js';
import { NotFoundError } from '@/shared/utils/errors.js';

export const newsfeedController = {
  getFeed: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
      const feedPage = await newsfeedService.getFeed(req.user!.userId, limit, cursor);
      sendSuccess(res, feedPage);
    } catch (error) {
      next(error);
    }
  },

  createPost: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const post = await newsfeedService.createPost(req.user!.userId, req.body);
      sendCreated(res, post, 'Tạo bài viết thành công');
    } catch (error) {
      next(error);
    }
  },

  getPostById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const post = await newsfeedService.getPostById(req.params.postId, req.user!.userId);
      if (!post) throw new NotFoundError('Bài viết');
      sendSuccess(res, post);
    } catch (error) {
      next(error);
    }
  },

  updatePost: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await newsfeedService.updatePost(req.params.postId, req.user!.userId, req.body);
      sendSuccess(res, null, 'Cập nhật bài viết thành công');
    } catch (error) {
      next(error);
    }
  },

  deletePost: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await newsfeedService.deletePost(req.params.postId, req.user!.userId);
      sendSuccess(res, null, 'Xóa bài viết thành công');
    } catch (error) {
      next(error);
    }
  },

  reactToPost: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { type } = req.body as { type: string };
      await newsfeedService.reactToPost(req.params.postId, req.user!.userId, type);
      sendSuccess(res, null, 'Đã thả cảm xúc');
    } catch (error) {
      next(error);
    }
  },

  getComments: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
      const commentsPage = await newsfeedService.getComments(
        req.params.postId,
        req.user!.userId,
        limit,
        cursor,
      );
      sendSuccess(res, commentsPage);
    } catch (error) {
      next(error);
    }
  },

  addComment: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { content, parentId } = req.body as { content: string; parentId?: string };
      const comment = await newsfeedService.addComment(
        req.params.postId,
        req.user!.userId,
        content,
        parentId,
      );
      sendCreated(res, comment, 'Thêm bình luận thành công');
    } catch (error) {
      next(error);
    }
  },

  createReel: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const reel = await newsfeedService.createReel(req.user!.userId, req.body);
      sendCreated(res, reel, 'Tạo reel thành công');
    } catch (error) {
      next(error);
    }
  },

  getReels: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const reels = await newsfeedService.getReels(limit);
      sendSuccess(res, reels);
    } catch (error) {
      next(error);
    }
  },
};
