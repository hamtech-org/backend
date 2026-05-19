import { Router } from 'express';
import { messageController } from './message.controller.js';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';
import { validate } from '@/shared/middlewares/validate.middleware.js';
import {
  sendMessageSchema,
  editMessageSchema,
  deleteMessageSchema,
  recallMessageSchema,
  markAsReadSchema,
  reactMessageSchema,
} from './message.validator.js';

const router = Router();

// Messages trong conversation (browse phải khai báo trước path /messages tĩnh)
router.get(
  '/conversations/:conversationId/messages/browse',
  authenticate,
  messageController.browseMessages,
);
router.get(
  '/conversations/:conversationId/messages/paginated',
  authenticate,
  messageController.getMessagesPaginated,
);
router.get('/conversations/:conversationId/messages', authenticate, messageController.getMessages);
router.get(
  '/conversations/:conversationId/gallery',
  authenticate,
  messageController.getMessageGallery,
);
router.post(
  '/conversations/:conversationId/messages',
  authenticate,
  validate(sendMessageSchema),
  messageController.sendMessage,
);
router.post(
  '/conversations/:conversationId/read',
  authenticate,
  validate(markAsReadSchema),
  messageController.markAsRead,
);

// Message actions
router.put(
  '/messages/:messageId',
  authenticate,
  validate(editMessageSchema),
  messageController.editMessage,
);
router.delete(
  '/messages/:messageId',
  authenticate,
  validate(deleteMessageSchema),
  messageController.deleteMessage,
);
router.post(
  '/messages/:messageId/recall',
  authenticate,
  validate(recallMessageSchema),
  messageController.recallMessage,
);
router.post('/messages/:messageId/pin', authenticate, messageController.pinMessage);
router.delete('/messages/:messageId/pin', authenticate, messageController.unpinMessage);
router.post(
  '/messages/:messageId/react',
  authenticate,
  validate(reactMessageSchema),
  messageController.reactToMessage,
);

export default router;
