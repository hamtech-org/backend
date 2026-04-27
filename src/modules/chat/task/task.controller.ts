import { Request, Response, NextFunction } from 'express';
import { taskService } from './task.service.js';
import { sendSuccess, sendCreated } from '@/shared/utils/response.js';
import { emitToConversationAndMembers } from '../shared/chat.broadcast.js';
import { ValidationError } from '@/shared/utils/errors.js';

export const taskController = {
  createTask: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const title = String((req.body as any)?.title ?? '').trim();
      const dueDate = String((req.body as any)?.dueDate ?? '').trim();
      const assignToAll = (req.body as any)?.assignToAll === true;
      const assignees = Array.isArray((req.body as any)?.assignees)
        ? ((req.body as any).assignees as unknown[]).map((x) => String(x)).filter(Boolean)
        : [];
      const subtasks = Array.isArray((req.body as any)?.subtasks) ? (req.body as any).subtasks : [];

      if (!title) throw new ValidationError('Tiêu đề công việc là bắt buộc');
      if (!dueDate) throw new ValidationError('Thời hạn công việc là bắt buộc');
      if (!assignToAll && assignees.length === 0) {
        throw new ValidationError('Vui lòng chọn người được giao (hoặc chọn “Giao cho cả nhóm”)');
      }
      // Nếu có subtasks thì cũng phải có người giao (hoặc cả nhóm) — trùng rule trên.
      if (Array.isArray(subtasks) && subtasks.length > 0 && !assignToAll && assignees.length === 0) {
        throw new ValidationError('Vui lòng chọn người được giao (hoặc chọn “Giao cho cả nhóm”)');
      }

      const task = await taskService.createTask(req.user!.userId, req.params.groupId, req.body);
      try {
        await emitToConversationAndMembers(req.params.groupId, 'group:task_new', {
          groupId: req.params.groupId,
          taskId: task.taskId,
          title: String((task as { title?: string })?.title ?? ''),
        });
      } catch {
        /* ignore socket */
      }
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
      const { title } = await taskService.updateTaskStatus(
        req.user!.userId,
        req.params.groupId,
        req.params.taskId,
        req.body.status,
      );
      try {
        await emitToConversationAndMembers(req.params.groupId, 'group:task_updated', {
          groupId: req.params.groupId,
          taskId: req.params.taskId,
          title,
        });
      } catch {
        /* ignore socket */
      }
      sendSuccess(res, null, 'Cập nhật trạng thái thành công');
    } catch (error) {
      console.error('[updateTaskStatus]', error);
      next(error);
    }
  },

  joinTask: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const task = await taskService.joinTask(req.user!.userId, req.params.groupId, req.params.taskId);
      try {
        await emitToConversationAndMembers(req.params.groupId, 'group:task_updated', {
          groupId: req.params.groupId,
          taskId: req.params.taskId,
          title: String((task as { title?: string })?.title ?? ''),
        });
      } catch {
        /* ignore socket */
      }
      sendSuccess(res, task, 'Đã tham gia công việc');
    } catch (error) {
      console.error('[joinTask]', error);
      next(error);
    }
  },

  patchTask: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const task = await taskService.patchTaskByCreator(req.user!.userId, req.params.groupId, req.params.taskId, req.body);
      try {
        await emitToConversationAndMembers(req.params.groupId, 'group:task_updated', {
          groupId: req.params.groupId,
          taskId: req.params.taskId,
          title: String((task as { title?: string })?.title ?? ''),
        });
      } catch {
        /* ignore socket */
      }
      sendSuccess(res, task, 'Đã cập nhật công việc');
    } catch (error) {
      console.error('[patchTask]', error);
      next(error);
    }
  },

  deleteTask: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { deletedTitle } = await taskService.deleteTaskByCreator(
        req.user!.userId,
        req.params.groupId,
        req.params.taskId,
      );
      try {
        await emitToConversationAndMembers(req.params.groupId, 'group:task_deleted', {
          groupId: req.params.groupId,
          taskId: req.params.taskId,
          title: deletedTitle,
        });
      } catch {
        /* ignore socket */
      }
      sendSuccess(res, null, 'Đã hủy công việc');
    } catch (error) {
      console.error('[deleteTask]', error);
      next(error);
    }
  },

  broadcastDueReminder: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await taskService.broadcastDueReminder(
        req.user!.userId,
        req.params.groupId,
        req.params.taskId,
      );
      sendSuccess(res, result);
    } catch (error) {
      console.error('[broadcastDueReminder]', error);
      next(error);
    }
  },
};
