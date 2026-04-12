import { Router } from 'express';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';
import { getRtcToken } from './agora.controller.js';

const router = Router();

router.get('/rtc-token', authenticate, getRtcToken);

export default router;
