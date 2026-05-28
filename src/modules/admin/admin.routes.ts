import { Router } from 'express';
import { adminController } from './admin.controller.js';
import { authenticate, authorize } from '@/shared/middlewares/auth.middleware.js';
import { validate, validateQuery } from '@/shared/middlewares/validate.middleware.js';
import {
  adminListQuerySchema,
  createAdminUserSchema,
  updateAdminUserSchema,
  updateAdminUserRoleSchema,
  createAdminGroupSchema,
  updateAdminGroupSchema,
  createAdminPostSchema,
  updateAdminPostSchema,
  analyticsDashboardQuerySchema,
} from './admin.validator.js';

const router = Router();

router.use(authenticate, authorize('admin'));

// Users
router.get('/users', validateQuery(adminListQuerySchema), adminController.listUsers);
router.get('/users/:userId', adminController.getUser);
router.post('/users', validate(createAdminUserSchema), adminController.createUser);
router.put('/users/:userId', validate(updateAdminUserSchema), adminController.updateUser);
router.put(
  '/users/:userId/role',
  validate(updateAdminUserRoleSchema),
  adminController.updateUserRole,
);
router.delete('/users/:userId', adminController.deleteUser);

// Groups
router.get('/groups', validateQuery(adminListQuerySchema), adminController.listGroups);
router.get('/groups/:groupId', adminController.getGroup);
router.post('/groups', validate(createAdminGroupSchema), adminController.createGroup);
router.put('/groups/:groupId', validate(updateAdminGroupSchema), adminController.updateGroup);
router.delete('/groups/:groupId', adminController.deleteGroup);

// Posts
router.get('/posts', validateQuery(adminListQuerySchema), adminController.listPosts);
router.get('/posts/:postId', adminController.getPost);
router.post('/posts', validate(createAdminPostSchema), adminController.createPost);
router.put('/posts/:postId', validate(updateAdminPostSchema), adminController.updatePost);
router.delete('/posts/:postId', adminController.deletePost);

// Analytics (giữ nguyên)
router.get('/analytics/users', adminController.getAnalytics);
router.get('/analytics/engagement', adminController.getAnalytics);
router.get('/analytics/posts', adminController.getAnalytics);
router.get('/analytics/groups', adminController.getAnalytics);
router.get(
  '/analytics/dashboard',
  validateQuery(analyticsDashboardQuerySchema),
  adminController.getAnalyticsDashboard,
);
router.get('/resources/summary', adminController.getResourceSummary);

export default router;
