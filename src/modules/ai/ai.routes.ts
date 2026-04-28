import { Router } from 'express';
import { aiController } from './ai.controller.js';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';

const router = Router();

router.post('/suggest-content', authenticate, aiController.suggestContent);
router.post('/suggest-reply-context', authenticate, aiController.suggestReplyFromContext);
router.post('/group-summary', authenticate, aiController.summarizeGroupMessages);
router.post('/chatbot', authenticate, aiController.chatbot);
router.post('/sentiment', authenticate, aiController.analyzeSentiment);
router.post('/generate-post', authenticate, aiController.generatePost);

export default router;
