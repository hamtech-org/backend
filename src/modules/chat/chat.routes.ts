import { Router } from 'express';
import { chatController } from './chat.controller.js';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';
import { validate } from '@/shared/middlewares/validate.middleware.js';
import {
  createConversationSchema,
  sendMessageSchema,
  editMessageSchema,
  deleteMessageSchema,
  recallMessageSchema,
  markAsReadSchema,
  reactMessageSchema,
} from './chat.validator.js';

const router = Router();

// ─── Conversations ────────────────────────────────────────────────────────────
router.get('/conversations', authenticate, chatController.getConversations);
router.post('/conversations', authenticate, validate(createConversationSchema), chatController.createConversation);
router.get('/conversations/:conversationId', authenticate, chatController.getConversation);
router.get('/conversations/:conversationId/messages', authenticate, chatController.getMessages);
router.post('/conversations/:conversationId/messages', authenticate, validate(sendMessageSchema), chatController.sendMessage);
router.post('/conversations/:conversationId/read', authenticate, validate(markAsReadSchema), chatController.markAsRead);

// ─── Messages ─────────────────────────────────────────────────────────────────
router.put('/messages/:messageId', authenticate, validate(editMessageSchema), chatController.editMessage);
router.delete('/messages/:messageId', authenticate, validate(deleteMessageSchema), chatController.deleteMessage);
router.post('/messages/:messageId/recall', authenticate, validate(recallMessageSchema), chatController.recallMessage);
router.post('/messages/:messageId/pin', authenticate, chatController.pinMessage);
router.delete('/messages/:messageId/pin', authenticate, chatController.unpinMessage);
router.post('/messages/:messageId/react', authenticate, validate(reactMessageSchema), chatController.reactToMessage);

export default router;
