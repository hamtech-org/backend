import { Router } from 'express';
import { authController } from './auth.controller.js';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';
import { validate } from '@/shared/middlewares/validate.middleware.js';
import { loginLimiter } from '@/shared/middlewares/rateLimiter.middleware.js';
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  faceLoginSchema,
  enableFaceLoginSchema,
  verifyEmailSchema,
  verifyLoginOtpSchema,
  logoutSchema,
} from './auth.validator.js';

const router = Router();

// ── Public routes ──
router.post('/register', validate(registerSchema), authController.register);
router.post('/verify-email', validate(verifyEmailSchema), authController.verifyEmail);
router.post('/login', loginLimiter, validate(loginSchema), authController.login);
router.post('/verify-login-otp', validate(verifyLoginOtpSchema), authController.verifyLoginOtp);
router.post('/refresh-token', validate(refreshTokenSchema), authController.refreshToken);
router.post('/forgot-password', validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), authController.resetPassword);

// ── Face Login (public: login, protected: enable/disable) ──
// Step 1: Create liveness session
router.post('/face-liveness/start', authController.createLivenessSession);

// Step 2: Login with face (requires liveness session ID)
router.post('/face-login', loginLimiter, validate(faceLoginSchema), authController.loginWithFace);

// Step 3: Enable face login (protected: requires authentication + liveness session ID)
router.post(
  '/face-login/enable',
  authenticate,
  validate(enableFaceLoginSchema),
  authController.enableFaceLogin,
);

// Step 4: Disable face login
router.delete('/face-login/disable', authenticate, authController.disableFaceLogin);

// ── Protected routes (cần access token) ──
router.post('/logout', authenticate, validate(logoutSchema), authController.logout);
router.post('/logout-all', authenticate, authController.logoutAll);
router.get('/sessions', authenticate, authController.listSessions);
router.delete('/sessions/:sessionId', authenticate, authController.revokeSession);
router.put(
  '/change-password',
  authenticate,
  validate(changePasswordSchema),
  authController.changePassword,
);

export default router;
