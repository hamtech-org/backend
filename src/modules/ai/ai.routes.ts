import { Router } from 'express';
import { aiController } from './ai.controller.js';
import { aiAdminController } from './admin/ai-admin.controller.js';
import { authenticate, authorize } from '@/shared/middlewares/auth.middleware.js';

const router = Router();

router.post('/suggest-content', authenticate, aiController.suggestContent);
router.post('/suggest-reply-context', authenticate, aiController.suggestReplyFromContext);
router.post('/group-summary', authenticate, aiController.summarizeGroupMessages);
router.post('/chatbot', authenticate, aiController.chatbot);
router.post('/sentiment', authenticate, aiController.analyzeSentiment);
router.post('/generate-post', authenticate, aiController.generatePost);
router.post('/assistant', authenticate, aiController.aiAssistant);
router.get('/assistant/thread', authenticate, aiController.getAiAssistantThread);
router.delete('/assistant/thread', authenticate, aiController.clearAiAssistantThread);
router.get('/admin/dashboard', authenticate, authorize('admin'), aiAdminController.getDashboard);
router.put('/admin/config', authenticate, authorize('admin'), aiAdminController.updateConfig);

export default router;
