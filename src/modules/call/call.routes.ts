import { Router } from 'express';
import { callController } from './call.controller.js';
import { authenticateOptional } from '@/shared/middlewares/auth-optional.middleware.js';

const router = Router();

router.post('/accept', authenticateOptional, callController.acceptCall);
router.post('/decline', authenticateOptional, callController.declineCall);

export default router;
