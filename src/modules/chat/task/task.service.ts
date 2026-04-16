import { v4 as uuidv4 } from 'uuid';
import { conversationRepository } from '../conversation/conversation.repository.js';
import { taskRepository } from './task.repository.js';
import { NotFoundError, ForbiddenError } from '@/shared/utils/errors.js';
import { userRepository } from '@/modules/user/user.repository.js';
import { createAndBroadcastSystemMessage } from '../shared/system-message.factory.js';

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
    };
    await taskRepository.createTask(task);

    // System message
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

      await createAndBroadcastSystemMessage(
        { conversationId, senderId: requesterId, content: JSON.stringify(payload) },
        sysMsgDeps,
      );
    } catch { /* ignore */ }

    return task;
  },

  getTasks: async (conversationId: string): Promise<any[]> => {
    return taskRepository.getTasks(conversationId);
  },

  updateTaskStatus: async (conversationId: string, taskId: string, status: string): Promise<void> => {
    await taskRepository.updateTask(conversationId, taskId, { status });
  },

  joinTask: async (requesterId: string, conversationId: string, taskId: string): Promise<any> => {
    const members = await conversationRepository.getConversationMembers(conversationId);
    const isMember = members.some((m) => m.userId === requesterId);
    if (!isMember) throw new ForbiddenError('Bạn không thuộc nhóm');

    const tasks = await taskRepository.getTasks(conversationId);
    const task = tasks.find((t: any) => String(t?.taskId) === String(taskId));
    if (!task) throw new NotFoundError('Công việc');

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

  deleteTask: async (requesterId: string, conversationId: string, taskId: string): Promise<void> => {
    await taskRepository.deleteTask(conversationId, taskId);
  },
};
