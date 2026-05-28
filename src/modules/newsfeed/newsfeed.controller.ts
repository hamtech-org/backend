import { Request, Response, NextFunction } from 'express';
import { newsfeedService } from './newsfeed.service.js';
import { sendSuccess, sendCreated } from '@/shared/utils/response.js';
import { NotFoundError } from '@/shared/utils/errors.js';
import type { ReactionType, ReelFeedKind } from './newsfeed.types.js';

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

  getReelsFeed: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const feed = (typeof req.query.feed === 'string' ? req.query.feed : 'foryou') as ReelFeedKind;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
      const page = await newsfeedService.getReelsFeed(req.user!.userId, feed, limit, cursor);
      sendSuccess(res, page);
    } catch (error) {
      next(error);
    }
  },

  getReelById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const reel = await newsfeedService.getReelById(req.params.reelId, req.user!.userId);
      if (!reel) throw new NotFoundError('Reel');
      sendSuccess(res, reel);
    } catch (error) {
      next(error);
    }
  },

  deleteReel: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await newsfeedService.deleteReel(req.params.reelId, req.user!.userId);
      sendSuccess(res, null, 'Đã xóa reel');
    } catch (error) {
      next(error);
    }
  },

  recordReelView: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { watchedMs, completed } = req.body as { watchedMs: number; completed?: boolean };
      await newsfeedService.recordReelView(
        req.params.reelId,
        req.user!.userId,
        watchedMs,
        completed,
      );
      sendSuccess(res, null);
    } catch (error) {
      next(error);
    }
  },

  toggleSaveReel: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await newsfeedService.toggleSaveReel(req.params.reelId, req.user!.userId);
      sendSuccess(res, result, result.isSaved ? 'Đã lưu reel' : 'Đã bỏ lưu reel');
    } catch (error) {
      next(error);
    }
  },

  reportReel: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await newsfeedService.reportReel(req.params.reelId, req.user!.userId, req.body);
      sendSuccess(res, null, 'Đã gửi báo cáo');
    } catch (error) {
      next(error);
    }
  },

  getReelComments: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
      const parentId = typeof req.query.parentId === 'string' ? req.query.parentId : null;
      const page = await newsfeedService.getReelComments(
        req.params.reelId,
        req.user!.userId,
        limit,
        cursor,
        parentId,
      );
      sendSuccess(res, page);
    } catch (error) {
      next(error);
    }
  },

  addReelComment: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { content, parentId, mediaUrls } = req.body as {
        content?: string;
        parentId?: string;
        mediaUrls?: string[];
      };
      const comment = await newsfeedService.addReelComment(
        req.params.reelId,
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

  getReelsByAuthor: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
      const page = await newsfeedService.getReelsByAuthor(
        req.params.authorId,
        req.user!.userId,
        limit,
        cursor,
      );
      sendSuccess(res, page);
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

  reactToReelComment: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { type } = req.body as { type: ReactionType };
      const summary = await newsfeedService.reactToReelComment(
        req.params.reelId,
        req.params.commentId,
        req.user!.userId,
        type,
      );
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

  shareReel: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sharesCount = await newsfeedService.shareReel(req.params.reelId, req.user!.userId);
      sendSuccess(res, { sharesCount }, 'Chia sẻ reel thành công');
    } catch (error) {
      next(error);
    }
  },
};
