import { Router } from 'express';
import { authController } from './auth.controller.js';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';
import { validate } from '@/shared/middlewares/validate.middleware.js';
import { loginLimiter } from '@/shared/middlewares/rateLimiter.middleware.js';
import {
  registerSchema, loginSchema, refreshTokenSchema,
  forgotPasswordSchema, resetPasswordSchema, changePasswordSchema,
} from './auth.validator.js';

const router = Router();

router.post('/register', validate(registerSchema), authController.register);
router.post('/login', loginLimiter, validate(loginSchema), authController.login);
router.post('/refresh-token', validate(refreshTokenSchema), authController.refreshToken);
router.post('/logout', authenticate, authController.logout);
router.post('/forgot-password', validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), authController.resetPassword);
router.put('/change-password', authenticate, validate(changePasswordSchema), authController.changePassword);

export default router;
