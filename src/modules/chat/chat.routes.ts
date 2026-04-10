import { Router } from 'express';
import { chatController } from './chat.controller.js';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';
import { validate } from '@/shared/middlewares/validate.middleware.js';
import { createConversationSchema, updateGroupSchema, sendMessageSchema, editMessageSchema } from './chat.validator.js';

const router = Router();

// ─── Conversations ────────────────────────────────────────────────────────────
router.get('/conversations', authenticate, chatController.getConversations);
router.post('/conversations', authenticate, validate(createConversationSchema), chatController.createConversation);

// ─── Group APIs ──────────────────────────────────────────────────────────────
// POST /conversations (type=group) → tạo nhóm mới (dùng chung với createConversation)
// PUT  /groups/:groupId            → cập nhật tên/avatar nhóm
router.put('/groups/:groupId', authenticate, validate(updateGroupSchema), chatController.updateGroup);
// DELETE /groups/:groupId          → giải tán nhóm (chỉ owner)
router.delete('/groups/:groupId', authenticate, chatController.deleteGroup);
// POST /groups/:groupId/leave      → rời nhóm
router.post('/groups/:groupId/leave', authenticate, chatController.leaveGroup);

// ─── Messages ─────────────────────────────────────────────────────────────────
router.get('/conversations/:conversationId/messages', authenticate, chatController.getMessages);
router.post('/conversations/:conversationId/messages', authenticate, validate(sendMessageSchema), chatController.sendMessage);
router.put('/messages/:messageId', authenticate, validate(editMessageSchema), chatController.editMessage);
router.delete('/messages/:messageId', authenticate, chatController.deleteMessage);
router.post('/messages/:messageId/recall', authenticate, chatController.recallMessage);

export default router;
