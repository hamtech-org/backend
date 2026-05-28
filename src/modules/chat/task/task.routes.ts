import { Router } from 'express';
import { taskController } from './task.controller.js';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';

const router = Router();

router.get('/groups/:groupId/tasks', authenticate, taskController.getTasks);
router.post('/groups/:groupId/tasks', authenticate, taskController.createTask);
router.patch('/groups/:groupId/tasks/:taskId', authenticate, taskController.patchTask);
router.delete('/groups/:groupId/tasks/:taskId', authenticate, taskController.deleteTask);
router.put('/groups/:groupId/tasks/:taskId', authenticate, taskController.updateTaskStatus);
router.post('/groups/:groupId/tasks/:taskId/join', authenticate, taskController.joinTask);
router.post('/groups/:groupId/tasks/:taskId/remind-due', authenticate, taskController.broadcastDueReminder);

export default router;
