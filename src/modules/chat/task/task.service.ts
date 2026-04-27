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

function parseDueDateToMs(raw: unknown): number {
  const s = String(raw ?? '').trim();
  if (!s) return NaN;
  const ms = new Date(s).getTime();
  if (Number.isFinite(ms)) return ms;

  // Support common VN formats:
  // - dd/MM/yyyy HH:mm
  // - dd-MM-yyyy HH:mm
  // - dd/MM/yyyy
  // - dd-MM-yyyy
  const m =
    s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/) ??
    s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!m) return NaN;

  // Two possible shapes:
  // 1) dd/MM/yyyy
  // 2) yyyy-MM-dd
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const hh = m[4] ? Number(m[4]) : 0;
  const mm = m[5] ? Number(m[5]) : 0;

  const year = m[0].startsWith(String(a)) && String(a).length === 4 ? a : c;
  const month = m[0].startsWith(String(a)) && String(a).length === 4 ? b : b;
  const day = m[0].startsWith(String(a)) && String(a).length === 4 ? c : a;

  const d = new Date(year, Math.max(0, month - 1), day, hh, mm, 0, 0);
  const out = d.getTime();
  return Number.isFinite(out) ? out : NaN;
}

async function normalizeSubtasksWithNames(subtasks: unknown): Promise<any[] | undefined> {
  if (!Array.isArray(subtasks) || subtasks.length === 0) return undefined;
  const rows = subtasks
    .map((s) => ({
      id: (s as any)?.id,
      assigneeId: String((s as any)?.assigneeId ?? '').trim(),
      content: String((s as any)?.content ?? '').trim(),
      done: Boolean((s as any)?.done),
      completedAt: (s as any)?.completedAt ?? null,
    }))
    .filter((s) => Boolean(s.assigneeId && s.content));
  if (rows.length === 0) return undefined;

  const ids = Array.from(new Set(rows.map((r) => r.assigneeId).filter(Boolean)));
  const nameById = new Map<string, string>();
  try {
    const users = await userRepository.findByIds(ids);
    for (const u of users) {
      const name = String((u as any)?.displayName ?? (u as any)?.email ?? (u as any)?.userId ?? '').trim();
      if (name) nameById.set(String((u as any)?.userId), name);
    }
  } catch {
    /* ignore */
  }

  return rows.map((r) => ({
    ...r,
    assigneeName: nameById.get(r.assigneeId) ?? r.assigneeId,
  }));
}

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

    const normalizedSubtasks = await normalizeSubtasksWithNames(data.subtasks);
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
      assignToAll: data.assignToAll === true,
      broadcast: data.broadcast === true,
      ...(normalizedSubtasks ? { subtasks: normalizedSubtasks } : {}),
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
          assigneeUserIds: Array.isArray(assignees) ? assignees.map((id) => String(id)) : [],
          ...(normalizedSubtasks ? { subtasks: normalizedSubtasks } : {}),
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

  updateTaskStatus: async (
    requesterId: string,
    conversationId: string,
    taskId: string,
    status: string,
  ): Promise<{ title: string }> => {
    const tasks = await taskRepository.getTasks(conversationId);
    const task = tasks.find((t: any) => String(t?.taskId) === String(taskId));
    const title = String((task as any)?.title ?? '');
    await taskRepository.updateTask(conversationId, taskId, { status });

    // Thông báo trong khung chat (system message) để cả nhóm thấy realtime.
    try {
      let actorName = 'Ai đó';
      try {
        const users = await userRepository.findByIds([requesterId]);
        actorName = users[0]?.displayName || actorName;
      } catch {
        /* ignore */
      }
      const payload = {
        kind: 'task_updated',
        task: { taskId: String(taskId), title },
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
      const dueMs = parseDueDateToMs(dueRaw);
      if (Number.isFinite(dueMs) && Date.now() > dueMs) {
        throw new ForbiddenError('Đã quá hạn xác nhận tham gia công việc');
      }
    }

    const assignees = Array.isArray((task as any).assignees) ? ((task as any).assignees as string[]) : [];
    const assignToAll = Boolean((task as any).assignToAll);
    const broadcast = Boolean((task as any).broadcast);
    const subs = Array.isArray((task as any).subtasks) ? ((task as any).subtasks as any[]) : [];
    const subAssigneeIds = subs
      .map((s) => String(s?.assigneeId ?? '').trim())
      .filter(Boolean);

    // - Task opt-in cả nhóm: assignToAll/broadcast (hoặc legacy: không có assignees + không chia subtask).
    // - Task chia theo subtask: chỉ những người xuất hiện trong subtasks được join.
    const isEveryoneTask =
      assignToAll || broadcast || (assignees.length === 0 && subAssigneeIds.length === 0);
    const isSubtaskAssignee = subAssigneeIds.includes(requesterId);
    const isTopLevelAssignee = assignees.includes(requesterId);

    if (!isEveryoneTask && !isTopLevelAssignee && !isSubtaskAssignee) {
      throw new ForbiddenError('Bạn không được giao công việc này');
    }

    const prev = Array.isArray((task as any).participants) ? (task as any).participants : [];
    const joinedNow = !prev.includes(requesterId);
    const next = joinedNow ? [...prev, requesterId] : prev;
    await taskRepository.updateTask(conversationId, taskId, { participants: next });

    let joinNotice: IMessage | null = null;
    if (joinedNow) {
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

        joinNotice = await createAndBroadcastSystemMessage(
          { conversationId, senderId: requesterId, content: JSON.stringify(payload) },
          sysMsgDeps,
        );
      } catch {
        /* ignore */
      }
    }

    return { ...task, participants: next, joinNotice };
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
    if (data.assignToAll !== undefined) updates.assignToAll = data.assignToAll === true;
    if (data.broadcast !== undefined) updates.broadcast = data.broadcast === true;
    if (data.subtasks !== undefined) {
      updates.subtasks = (await normalizeSubtasksWithNames(data.subtasks)) ?? [];
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

  broadcastDueReminder: async (
    requesterId: string,
    conversationId: string,
    taskId: string,
    opts?: { skipMemberCheck?: boolean; senderIdOverride?: string | null },
  ): Promise<{ sent: boolean }> => {
    const members = await conversationRepository.getConversationMembers(conversationId);
    if (!opts?.skipMemberCheck) {
      const isMember = members.some((m) => m.userId === requesterId);
      if (!isMember) throw new ForbiddenError('Bạn không thuộc nhóm');
    }

    const tasks = await taskRepository.getTasks(conversationId);
    const task = tasks.find((t: any) => String(t?.taskId) === String(taskId));
    if (!task) throw new NotFoundError('Công việc');

    const title = String((task as any)?.title ?? '').trim();
    const dueRaw = (task as any).dueDate;
    const dueMs = parseDueDateToMs(dueRaw);
    if (!Number.isFinite(dueMs)) return { sent: false };

    // Only allow broadcasting after due time (grace: 24h) to avoid spam.
    const now = Date.now();
    if (now < dueMs) return { sent: false };
    if (now - dueMs > 24 * 60 * 60_000) return { sent: false };

    // Permission: only assignees/subtask assignees or everyone-task members can trigger.
    const assignees = Array.isArray((task as any).assignees) ? ((task as any).assignees as string[]) : [];
    const assignToAll = Boolean((task as any).assignToAll);
    const broadcast = Boolean((task as any).broadcast);
    const subs = Array.isArray((task as any).subtasks) ? ((task as any).subtasks as any[]) : [];
    const subAssigneeIds = subs
      .map((s) => String(s?.assigneeId ?? '').trim())
      .filter(Boolean);
    const isEveryoneTask = assignToAll || broadcast || (assignees.length === 0 && subAssigneeIds.length === 0);
    const isSubtaskAssignee = subAssigneeIds.includes(requesterId);
    const isTopLevelAssignee = assignees.includes(requesterId);
    if (!isEveryoneTask && !isTopLevelAssignee && !isSubtaskAssignee) {
      throw new ForbiddenError('Bạn không được giao công việc này');
    }

    const sentAt = new Date().toISOString();
    const didSet = await taskRepository.setDueReminderOnce(conversationId, taskId, sentAt);
    if (!didSet) return { sent: false };

    try {
      const senderId =
        (opts?.senderIdOverride != null ? String(opts.senderIdOverride).trim() : '') ||
        String(members?.[0]?.userId ?? '').trim() ||
        requesterId;
      let actorName = 'Ai đó';
      try {
        const users = await userRepository.findByIds([senderId]);
        actorName = users[0]?.displayName || actorName;
      } catch {
        /* ignore */
      }
      const payload = {
        kind: 'task_due',
        task: {
          taskId: String((task as any).taskId ?? taskId),
          title,
          dueDate: (task as any).dueDate ?? null,
        },
        actor: { userId: senderId, name: actorName },
        createdAt: new Date().toISOString(),
      };
      await createAndBroadcastSystemMessage(
        { conversationId, senderId, content: JSON.stringify(payload) },
        sysMsgDeps,
      );
    } catch {
      /* ignore */
    }

    return { sent: true };
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
