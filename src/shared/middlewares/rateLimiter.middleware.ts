import rateLimit from 'express-rate-limit';
import { env } from '@/config/env.js';

export const apiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT', message: 'Quá nhiều request, vui lòng thử lại sau' },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT', message: 'Quá nhiều lần đăng nhập thất bại' },
  },
});

export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT', message: 'Quá nhiều lần upload' },
  },
});

export const reelCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.user?.userId ?? req.ip ?? 'anonymous',
  message: {
    success: false,
    error: { code: 'RATE_LIMIT', message: 'Bạn đã đăng quá nhiều reel, thử lại sau' },
  },
  standardHeaders: true,
  legacyHeaders: false,
});
