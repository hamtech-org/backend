import { Router } from 'express';
import { userController } from './user.controller.js';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';
import { validate } from '@/shared/middlewares/validate.middleware.js';
import { updateProfileSchema } from './user.validator.js';

const router = Router();

// ── Protected routes (cần auth) ──
router.get('/me', authenticate, userController.getProfile);
router.put('/me', authenticate, validate(updateProfileSchema), userController.updateProfile);
router.get('/search', authenticate, userController.searchUsers);
router.post('/multiple', authenticate, userController.getMultipleUsers);
router.get('/:userId', authenticate, userController.getUserById);

export default router;
