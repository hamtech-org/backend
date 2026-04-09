import { Router } from 'express';
import { chatController } from './chat.controller.js';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';
import { validate } from '@/shared/middlewares/validate.middleware.js';
import { createConversationSchema, sendMessageSchema, editMessageSchema } from './chat.validator.js';

const router = Router();

router.get('/conversations', authenticate, chatController.getConversations);
router.post('/conversations', authenticate, validate(createConversationSchema), chatController.createConversation);
router.get('/conversations/:conversationId/messages', authenticate, chatController.getMessages);
router.post('/conversations/:conversationId/messages', authenticate, validate(sendMessageSchema), chatController.sendMessage);
router.put('/messages/:messageId', authenticate, validate(editMessageSchema), chatController.editMessage);
router.delete('/messages/:messageId', authenticate, chatController.deleteMessage);
router.post('/messages/:messageId/recall', authenticate, chatController.recallMessage);

export default router;
