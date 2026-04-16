import { Router } from 'express';
import { taskController } from './task.controller.js';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';

const router = Router();

router.get('/groups/:groupId/tasks', authenticate, taskController.getTasks);
router.post('/groups/:groupId/tasks', authenticate, taskController.createTask);
router.put('/groups/:groupId/tasks/:taskId', authenticate, taskController.updateTaskStatus);
router.post('/groups/:groupId/tasks/:taskId/join', authenticate, taskController.joinTask);

export default router;
