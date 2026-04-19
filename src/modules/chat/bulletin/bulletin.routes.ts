import { Router } from 'express';
import { bulletinController } from './bulletin.controller.js';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';

const router = Router();

router.get('/groups/:groupId/bulletin', authenticate, bulletinController.getBulletinFeed);

export default router;
