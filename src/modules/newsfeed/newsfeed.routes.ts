import { Router } from 'express';
import { newsfeedController } from './newsfeed.controller.js';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';
import { validate } from '@/shared/middlewares/validate.middleware.js';
import {
  createPostSchema, updatePostSchema, createReelSchema,
  addCommentSchema, reactSchema,
} from './newsfeed.validator.js';

const router = Router();

router.get('/feed', authenticate, newsfeedController.getFeed);
router.post('/posts', authenticate, validate(createPostSchema), newsfeedController.createPost);
router.get('/posts/:postId', authenticate, newsfeedController.getPostById);
router.put('/posts/:postId', authenticate, validate(updatePostSchema), newsfeedController.updatePost);
router.delete('/posts/:postId', authenticate, newsfeedController.deletePost);
router.post('/posts/:postId/react', authenticate, validate(reactSchema), newsfeedController.reactToPost);
router.get('/posts/:postId/comments', authenticate, newsfeedController.getComments);
router.post('/posts/:postId/comments', authenticate, validate(addCommentSchema), newsfeedController.addComment);
router.get('/reels', authenticate, newsfeedController.getReels);
router.post('/reels', authenticate, validate(createReelSchema), newsfeedController.createReel);

export default router;
