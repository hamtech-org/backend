import { Router } from 'express';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';
import {
  validate,
  validateParams,
  validateQuery,
} from '@/shared/middlewares/validate.middleware.js';
import { notificationController } from './notification.controller.js';
import {
  listNotificationsQuerySchema,
  markNotificationReadParamsSchema,
  registerDeviceTokenSchema,
} from './notification.validator.js';
import { z } from 'zod';

const router = Router();

router.get(
  '/',
  authenticate,
  validateQuery(listNotificationsQuerySchema),
  notificationController.list,
);
router.get('/unread-count', authenticate, notificationController.unreadCount);
router.patch(
  '/:notificationId/read',
  authenticate,
  validateParams(markNotificationReadParamsSchema),
  notificationController.markRead,
);
router.post('/read-all', authenticate, notificationController.markAllRead);
router.post(
  '/device-tokens',
  authenticate,
  validate(registerDeviceTokenSchema),
  notificationController.registerDeviceToken,
);
router.delete(
  '/device-tokens',
  authenticate,
  validate(z.object({ token: z.string().min(10) })),
  notificationController.removeDeviceToken,
);

export default router;
