import { Router } from 'express';
import { newsfeedController } from './newsfeed.controller.js';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';
import { validate, validateQuery } from '@/shared/middlewares/validate.middleware.js';
import { reelCreateLimiter } from '@/shared/middlewares/rateLimiter.middleware.js';
import {
  createPostSchema,
  updatePostSchema,
  createReelSchema,
  addCommentSchema,
  reactSchema,
  reactCommentSchema,
  reactReelSchema,
  sharePostSchema,
  reelsFeedQuerySchema,
  reelViewSchema,
  reportReelSchema,
} from './newsfeed.validator.js';

const router = Router();

router.get('/feed', authenticate, newsfeedController.getFeed);
router.post('/posts', authenticate, validate(createPostSchema), newsfeedController.createPost);
router.get('/posts/by-author/:authorId', authenticate, newsfeedController.getPostsByAuthor);
router.get('/posts/:postId', authenticate, newsfeedController.getPostById);
router.put(
  '/posts/:postId',
  authenticate,
  validate(updatePostSchema),
  newsfeedController.updatePost,
);
router.delete('/posts/:postId', authenticate, newsfeedController.deletePost);
router.post(
  '/posts/:postId/react',
  authenticate,
  validate(reactSchema),
  newsfeedController.reactToPost,
);
router.get('/posts/:postId/comments', authenticate, newsfeedController.getComments);
router.post(
  '/posts/:postId/comments',
  authenticate,
  validate(addCommentSchema),
  newsfeedController.addComment,
);
router.get(
  '/reels',
  authenticate,
  validateQuery(reelsFeedQuerySchema),
  newsfeedController.getReelsFeed,
);
router.post(
  '/reels',
  authenticate,
  reelCreateLimiter,
  validate(createReelSchema),
  newsfeedController.createReel,
);
router.get('/reels/by-author/:authorId', authenticate, newsfeedController.getReelsByAuthor);
router.get('/reels/:reelId', authenticate, newsfeedController.getReelById);
router.delete('/reels/:reelId', authenticate, newsfeedController.deleteReel);
router.post(
  '/reels/:reelId/view',
  authenticate,
  validate(reelViewSchema),
  newsfeedController.recordReelView,
);
router.post('/reels/:reelId/save', authenticate, newsfeedController.toggleSaveReel);
router.post('/reels/:reelId/share', authenticate, newsfeedController.shareReel);
router.post(
  '/reels/:reelId/report',
  authenticate,
  validate(reportReelSchema),
  newsfeedController.reportReel,
);
router.get('/reels/:reelId/comments', authenticate, newsfeedController.getReelComments);
router.post(
  '/reels/:reelId/comments',
  authenticate,
  validate(addCommentSchema),
  newsfeedController.addReelComment,
);
router.post(
  '/reels/:reelId/comments/:commentId/react',
  authenticate,
  validate(reactReelSchema),
  newsfeedController.reactToReelComment,
);
router.post(
  '/comments/:commentId/react',
  authenticate,
  validate(reactCommentSchema),
  newsfeedController.reactToComment,
);
router.post(
  '/reels/:reelId/react',
  authenticate,
  validate(reactReelSchema),
  newsfeedController.reactToReel,
);

router.post(
  '/posts/:postId/share',
  authenticate,
  validate(sharePostSchema),
  newsfeedController.sharePost,
);
router.post('/posts/:postId/save', authenticate, newsfeedController.toggleSavePost);
router.get('/feed/saved', authenticate, newsfeedController.getSavedPosts);

export default router;
