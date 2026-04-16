import { Router } from 'express';
import conversationRoutes from './conversation/conversation.routes.js';
import messageRoutes from './message/message.routes.js';
import groupRoutes from './group/group.routes.js';
import memberRequestRoutes from './member-request/member-request.routes.js';
import pollRoutes from './poll/poll.routes.js';
import taskRoutes from './task/task.routes.js';
import aiRecapRoutes from './ai-recap/ai-recap.routes.js';

const router = Router();
router.use(conversationRoutes);
router.use(messageRoutes);
router.use(groupRoutes);
router.use(memberRequestRoutes);
router.use(pollRoutes);
router.use(taskRoutes);
router.use(aiRecapRoutes);

export default router;

// Re-export socket handler cho socket/handlers.ts
export { registerChatHandlers } from './message/message.socket.js';
