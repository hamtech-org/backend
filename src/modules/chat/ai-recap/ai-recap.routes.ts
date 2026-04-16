import { Router } from 'express';
import { aiRecapController } from './ai-recap.controller.js';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';

const router = Router();

router.post('/groups/:groupId/ai-recap', authenticate, aiRecapController.generateAIRecap);
router.get('/groups/:groupId/ai-recap/latest', authenticate, aiRecapController.getLatestAIRecap);

export default router;
