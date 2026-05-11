import { Request, Response, NextFunction } from 'express';
import { newsfeedService } from './newsfeed.service.js';
import { sendSuccess, sendCreated } from '@/shared/utils/response.js';
import { NotFoundError } from '@/shared/utils/errors.js';
import type { ReactionType } from './newsfeed.types.js';

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
      const { type } = req.body as { type: ReactionType };
      const summary = await newsfeedService.reactToPost(req.params.postId, req.user!.userId, type);
      sendSuccess(res, summary, 'Đã thả cảm xúc');
    } catch (error) {
      next(error);
    }
  },

  getComments: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
      const parentId = typeof req.query.parentId === 'string' ? req.query.parentId : null;
      const commentsPage = await newsfeedService.getComments(
        req.params.postId,
        req.user!.userId,
        limit,
        cursor,
        parentId,
      );
      sendSuccess(res, commentsPage);
    } catch (error) {
      next(error);
    }
  },

  addComment: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { content, parentId, mediaUrls } = req.body as {
        content?: string;
        parentId?: string;
        mediaUrls?: string[];
      };
      const comment = await newsfeedService.addComment(
        req.params.postId,
        req.user!.userId,
        content,
        parentId,
        mediaUrls,
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

  reactToComment: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { type, postId } = req.body as { type: ReactionType; postId: string };
      const summary = await newsfeedService.reactToComment(
        postId,
        req.params.commentId,
        req.user!.userId,
        type,
      );
      sendSuccess(res, summary, 'Đã thả cảm xúc');
    } catch (error) {
      next(error);
    }
  },

  reactToReel: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { type } = req.body as { type: ReactionType };
      const summary = await newsfeedService.reactToReel(req.params.reelId, req.user!.userId, type);
      sendSuccess(res, summary, 'Đã thả cảm xúc');
    } catch (error) {
      next(error);
    }
  },

  sharePost: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const post = await newsfeedService.sharePost(req.params.postId, req.user!.userId, req.body);
      sendCreated(res, post, 'Chia sẻ bài viết thành công');
    } catch (error) {
      next(error);
    }
  },

  toggleSavePost: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await newsfeedService.toggleSavePost(req.params.postId, req.user!.userId);
      sendSuccess(res, result, result.isSaved ? 'Đã lưu bài viết' : 'Đã bỏ lưu bài viết');
    } catch (error) {
      next(error);
    }
  },

  getSavedPosts: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
      const page = await newsfeedService.getSavedPosts(req.user!.userId, limit, cursor);
      sendSuccess(res, page);
    } catch (error) {
      next(error);
    }
  },
};
