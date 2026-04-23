import { Router } from 'express';
import { conversationController } from './conversation.controller.js';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';
import { validate } from '@/shared/middlewares/validate.middleware.js';
import { createConversationSchema, updateConversationPreferencesSchema } from './conversation.validator.js';

const router = Router();

router.get('/conversations', authenticate, conversationController.getConversations);
router.post('/conversations', authenticate, validate(createConversationSchema), conversationController.createConversation);
router.get('/conversations/:conversationId', authenticate, conversationController.getConversation);
router.patch(
  '/conversations/:conversationId/preferences',
  authenticate,
  validate(updateConversationPreferencesSchema),
  conversationController.patchPreferences,
);

export default router;
