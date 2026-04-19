import { Request, Response, NextFunction } from 'express';
import { taskService } from './task.service.js';
import { sendSuccess, sendCreated } from '@/shared/utils/response.js';
import { getIO } from '@/socket/index.js';

export const taskController = {
  createTask: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const task = await taskService.createTask(req.user!.userId, req.params.groupId, req.body);
      getIO().to(`conv:${req.params.groupId}`).emit('group:task_new', { groupId: req.params.groupId, taskId: task.taskId });
      sendCreated(res, task, 'Đã tạo công việc');
    } catch (error) {
      console.error('[createTask]', error);
      next(error);
    }
  },

  getTasks: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tasks = await taskService.getTasks(req.params.groupId);
      sendSuccess(res, tasks);
    } catch (error) {
      console.error('[getTasks]', error);
      next(error);
    }
  },

  updateTaskStatus: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await taskService.updateTaskStatus(req.params.groupId, req.params.taskId, req.body.status);
      getIO().to(`conv:${req.params.groupId}`).emit('group:task_updated', {
        groupId: req.params.groupId,
        taskId: req.params.taskId,
      });
      sendSuccess(res, null, 'Cập nhật trạng thái thành công');
    } catch (error) {
      console.error('[updateTaskStatus]', error);
      next(error);
    }
  },

  joinTask: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const task = await taskService.joinTask(req.user!.userId, req.params.groupId, req.params.taskId);
      getIO().to(`conv:${req.params.groupId}`).emit('group:task_updated', {
        groupId: req.params.groupId,
        taskId: req.params.taskId,
      });
      sendSuccess(res, task, 'Đã tham gia công việc');
    } catch (error) {
      console.error('[joinTask]', error);
      next(error);
    }
  },
};
