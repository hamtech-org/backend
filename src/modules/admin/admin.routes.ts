import { Router } from 'express';
import { adminController } from './admin.controller.js';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';
import { authorize } from '@/shared/middlewares/auth.middleware.js';
import { validate } from '@/shared/middlewares/validate.middleware.js';
import { moderatePostSchema, moderateGroupSchema } from './admin.validator.js';

const router = Router();

router.use(authenticate, authorize('admin'));

router.get('/groups', adminController.getGroups);
router.put('/groups/:groupId/moderate', validate(moderateGroupSchema), adminController.moderateGroup);
router.get('/posts', adminController.getPosts);
router.put('/posts/:postId', validate(moderatePostSchema), adminController.moderatePost);
router.delete('/posts/:postId', adminController.deletePost);
router.get('/analytics/users', adminController.getAnalytics);
router.get('/analytics/engagement', adminController.getAnalytics);
router.get('/analytics/posts', adminController.getAnalytics);
router.get('/analytics/groups', adminController.getAnalytics);
router.get('/resources/summary', adminController.getResourceSummary);

export default router;
