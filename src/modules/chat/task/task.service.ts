import { v4 as uuidv4 } from 'uuid';
import { conversationRepository } from '../conversation/conversation.repository.js';
import { taskRepository } from './task.repository.js';
import type { IMessage } from '../shared/chat.types.js';
import { NotFoundError, ForbiddenError } from '@/shared/utils/errors.js';
import { userRepository } from '@/modules/user/user.repository.js';
import { createAndBroadcastSystemMessage } from '../shared/system-message.factory.js';
import { messageService } from '../message/message.service.js';
import { emitEventsToConversationAndMembers } from '../shared/chat.broadcast.js';

const sysMsgDeps = {
  createMessage: conversationRepository.createMessage,
  updateConversationLastMessage: conversationRepository.updateConversationLastMessage,
};

export const taskService = {
  createTask: async (requesterId: string, conversationId: string, data: any): Promise<any> => {
    const taskId = uuidv4();
    const now = new Date().toISOString();

    let assignees: string[] = Array.isArray(data.assignees) ? data.assignees : [];
    if (data.assignToAll === true) {
      try {
        const members = await conversationRepository.getConversationMembers(conversationId);
        assignees = members.map((m) => m.userId);
      } catch {
        assignees = [];
      }
    }

    const task = {
      taskId,
      conversationId,
      creatorId: requesterId,
      title: data.title,
      description: data.description,
      assignees,
      participants: [],
      status: 'todo',
      dueDate: data.dueDate,
      createdAt: now,
      updatedAt: now,
      ...(Array.isArray(data.subtasks) && data.subtasks.length > 0 ? { subtasks: data.subtasks } : {}),
    };
    await taskRepository.createTask(task);

    let systemMessage: IMessage | null = null;
    try {
      let creatorName = 'Ai đó';
      try {
        const users = await userRepository.findByIds([requesterId]);
        creatorName = users[0]?.displayName || creatorName;
      } catch {}

      let assigneeLabel = 'cả nhóm';
      if (data.assignToAll !== true) {
        try {
          const assigneeProfiles = await userRepository.findByIds(assignees);
          const nameById = new Map(assigneeProfiles.map((u) => [u.userId, u.displayName || u.email || u.userId]));
          const names = assignees.map((id) => nameById.get(id) ?? id);
          const preview = names.slice(0, 3).join(', ');
          const more = Math.max(0, names.length - 3);
          assigneeLabel = more > 0 ? `${preview} và ${more} người khác` : preview || 'cả nhóm';
        } catch {
          assigneeLabel = assignees.length > 0 ? `${assignees.length} người` : 'cả nhóm';
        }
      }

      const note = String(task.description ?? '').trim();
      const payload = {
        kind: 'task_assigned',
        task: {
          taskId: String(task.taskId),
          title: String(task.title ?? ''),
          dueDate: task.dueDate ?? null,
          note: note || null,
          assigneeLabel: assigneeLabel || 'cả nhóm',
          assignToAll: data.assignToAll === true,
          assigneesCount: Array.isArray(assignees) ? assignees.length : 0,
        },
        actor: { userId: requesterId, name: creatorName },
        createdAt: now,
      };

      systemMessage = await createAndBroadcastSystemMessage(
        { conversationId, senderId: requesterId, content: JSON.stringify(payload) },
        sysMsgDeps,
      );
    } catch {
      /* ignore */
    }

    const explicitSource =
      typeof data.sourceMessageId === 'string' && data.sourceMessageId.trim().length > 0
        ? data.sourceMessageId.trim()
        : null;
    const sourceMessageId = systemMessage?.messageId ?? explicitSource ?? null;
    if (sourceMessageId) {
      try {
        await taskRepository.updateTask(conversationId, taskId, { sourceMessageId });
      } catch {
        /* ignore */
      }
    }

    return sourceMessageId ? { ...task, sourceMessageId } : task;
  },

  getTasks: async (conversationId: string): Promise<any[]> => {
    const rows = await taskRepository.getTasks(conversationId);
    const creatorIds = [...new Set(rows.map((t: { creatorId?: string }) => t.creatorId).filter(Boolean))] as string[];
    if (creatorIds.length === 0) return rows;
    const users = await userRepository.findByIds(creatorIds);
    const nameById = new Map(users.map((u) => [u.userId, u.displayName?.trim() || null]));
    return rows.map((t: { creatorId?: string }) => ({
      ...t,
      creatorDisplayName: t.creatorId ? nameById.get(t.creatorId) ?? null : null,
    }));
  },

  updateTaskStatus: async (conversationId: string, taskId: string, status: string): Promise<{ title: string }> => {
    const tasks = await taskRepository.getTasks(conversationId);
    const task = tasks.find((t: any) => String(t?.taskId) === String(taskId));
    const title = String((task as any)?.title ?? '');
    await taskRepository.updateTask(conversationId, taskId, { status });
    return { title };
  },

  joinTask: async (requesterId: string, conversationId: string, taskId: string): Promise<any> => {
    const members = await conversationRepository.getConversationMembers(conversationId);
    const isMember = members.some((m) => m.userId === requesterId);
    if (!isMember) throw new ForbiddenError('Bạn không thuộc nhóm');

    const tasks = await taskRepository.getTasks(conversationId);
    const task = tasks.find((t: any) => String(t?.taskId) === String(taskId));
    if (!task) throw new NotFoundError('Công việc');

    const dueRaw = (task as any).dueDate;
    if (dueRaw != null && String(dueRaw).trim() !== '') {
      const dueMs = new Date(String(dueRaw)).getTime();
      if (Number.isFinite(dueMs) && Date.now() > dueMs) {
        throw new ForbiddenError('Đã quá hạn xác nhận tham gia công việc');
      }
    }

    const assignees = Array.isArray((task as any).assignees) ? ((task as any).assignees as string[]) : [];
    if (!assignees.includes(requesterId)) throw new ForbiddenError('Bạn không được giao công việc này');

    const prev = Array.isArray((task as any).participants) ? (task as any).participants : [];
    const next = prev.includes(requesterId) ? prev : [...prev, requesterId];
    await taskRepository.updateTask(conversationId, taskId, { participants: next });

    // System message
    try {
      let actorName = 'Ai đó';
      try {
        const users = await userRepository.findByIds([requesterId]);
        actorName = users[0]?.displayName || actorName;
      } catch {}

      const payload = {
        kind: 'task_joined',
        task: { taskId: String((task as any).taskId ?? taskId), title: String((task as any).title ?? '') },
        actor: { userId: requesterId, name: actorName },
        participantsCount: next.length,
        createdAt: new Date().toISOString(),
      };

      await createAndBroadcastSystemMessage(
        { conversationId, senderId: requesterId, content: JSON.stringify(payload) },
        sysMsgDeps,
      );
    } catch { /* ignore */ }

    return { ...task, participants: next };
  },

  patchTaskByCreator: async (requesterId: string, conversationId: string, taskId: string, data: any): Promise<any> => {
    const members = await conversationRepository.getConversationMembers(conversationId);
    if (!members.some((m) => m.userId === requesterId)) {
      throw new ForbiddenError('Bạn không thuộc nhóm');
    }
    const tasks = await taskRepository.getTasks(conversationId);
    const task = tasks.find((t: any) => String(t?.taskId) === String(taskId));
    if (!task) throw new NotFoundError('Công việc');
    if (String((task as any).creatorId ?? '') !== String(requesterId)) {
      throw new ForbiddenError('Chỉ người tạo công việc mới chỉnh sửa được');
    }

    let assignees: string[] | undefined;
    if (data.assignToAll === true) {
      assignees = members.map((m) => m.userId);
    } else if (Array.isArray(data.assignees)) {
      assignees = data.assignees.map((id: unknown) => String(id));
    }

    const updates: Record<string, unknown> = {};
    if (data.title !== undefined) updates.title = String(data.title ?? '').trim();
    if (data.description !== undefined) updates.description = String(data.description ?? '').trim();
    if (data.dueDate !== undefined) updates.dueDate = data.dueDate == null || data.dueDate === '' ? null : data.dueDate;
    if (assignees !== undefined) updates.assignees = assignees;
    if (data.subtasks !== undefined) {
      updates.subtasks = Array.isArray(data.subtasks) ? data.subtasks : [];
    }

    if (Object.keys(updates).length === 0) return task;

    await taskRepository.updateTask(conversationId, taskId, updates);
    const next = await taskRepository.getTasks(conversationId);
    const updated =
      next.find((t: any) => String(t?.taskId) === String(taskId)) ?? ({ ...task, ...updates } as any);

    try {
      let actorName = 'Ai đó';
      try {
        const users = await userRepository.findByIds([requesterId]);
        actorName = users[0]?.displayName || actorName;
      } catch {
        /* ignore */
      }
      const titleStr = String((updated as any)?.title ?? '');
      const payload = {
        kind: 'task_updated',
        task: { taskId: String(taskId), title: titleStr },
        actor: { userId: requesterId, name: actorName },
        createdAt: new Date().toISOString(),
      };
      await createAndBroadcastSystemMessage(
        { conversationId, senderId: requesterId, content: JSON.stringify(payload) },
        sysMsgDeps,
      );
    } catch {
      /* ignore */
    }

    return updated;
  },

  deleteTaskByCreator: async (
    requesterId: string,
    conversationId: string,
    taskId: string,
  ): Promise<{ deletedTitle: string }> => {
    const members = await conversationRepository.getConversationMembers(conversationId);
    if (!members.some((m) => m.userId === requesterId)) {
      throw new ForbiddenError('Bạn không thuộc nhóm');
    }
    const tasks = await taskRepository.getTasks(conversationId);
    const task = tasks.find((t: any) => String(t?.taskId) === String(taskId));
    if (!task) throw new NotFoundError('Công việc');
    if (String((task as any).creatorId ?? '') !== String(requesterId)) {
      throw new ForbiddenError('Chỉ người tạo công việc mới hủy được');
    }
    const rawSrc = (task as any).sourceMessageId;
    const sourceMessageId =
      typeof rawSrc === 'string' && rawSrc.trim().length > 0 ? rawSrc.trim() : null;
    const deletedTitle = String((task as any).title ?? '');
    await taskRepository.deleteTask(conversationId, taskId);

    // Thu hồi tin giao việc (system) để cả nhóm không còn thấy thẻ — broadcast giống API recall.
    if (sourceMessageId) {
      try {
        const src = await conversationRepository.findMessageByMessageId(conversationId, sourceMessageId);
        if (src && String(src.senderId) === String(requesterId)) {
          await messageService.recallMessage(
            sourceMessageId,
            requesterId,
            conversationId,
            src.createdAt,
          );
          await emitEventsToConversationAndMembers(conversationId, [
            { event: 'message:recall', payload: { messageId: sourceMessageId, conversationId } },
            { event: 'message:recalled', payload: { messageId: sourceMessageId, conversationId } },
            {
              event: 'message:pin_updated',
              payload: { messageId: sourceMessageId, conversationId, isPinned: false },
            },
          ]);
        }
      } catch {
        /* ignore */
      }
    }

    try {
      let actorName = 'Ai đó';
      try {
        const users = await userRepository.findByIds([requesterId]);
        actorName = users[0]?.displayName || actorName;
      } catch {
        /* ignore */
      }
      const payload = {
        kind: 'task_deleted',
        task: { taskId: String(taskId), title: deletedTitle },
        actor: { userId: requesterId, name: actorName },
        createdAt: new Date().toISOString(),
      };
      await createAndBroadcastSystemMessage(
        { conversationId, senderId: requesterId, content: JSON.stringify(payload) },
        sysMsgDeps,
      );
    } catch {
      /* ignore */
    }

    return { deletedTitle };
  },
};
