import { conversationRepository } from '../conversation/conversation.repository.js';
import { emitToConversationAndMembers } from '../shared/chat.broadcast.js';
import { taskRepository } from './task.repository.js';

/**
 * Chỉ cập nhật task «giao cả nhóm» (assignToAll / broadcast):
 * đồng bộ assignees theo thành viên hiện tại, loại người đã rời khỏi participants.
 */
export async function syncAssignToAllTasksAfterMembershipChange(
  conversationId: string,
): Promise<number> {
  const gid = conversationId.trim();
  if (!gid) return 0;

  const memberIds = new Set(
    (await conversationRepository.getConversationMembers(gid)).map((m) => m.userId),
  );
  const tasks = await taskRepository.getTasks(gid);
  let updatedCount = 0;

  for (const task of tasks) {
    const assignToAll = Boolean(task.assignToAll);
    const broadcast = Boolean(task.broadcast);
    if (!assignToAll && !broadcast) continue;

    const taskId = String(task.taskId ?? '').trim();
    if (!taskId) continue;

    const nextAssignees = [...memberIds];
    const prevAssignees = (Array.isArray(task.assignees) ? task.assignees : []).map(String);
    const prevParticipants = (Array.isArray(task.participants) ? task.participants : []).map(
      String,
    );
    const nextParticipants = prevParticipants.filter((id) => memberIds.has(id));

    const updates: Record<string, unknown> = {};
    const assigneesKey = [...prevAssignees].sort().join('\0');
    const nextAssigneesKey = [...nextAssignees].sort().join('\0');
    if (assigneesKey !== nextAssigneesKey) {
      updates.assignees = nextAssignees;
    }
    if (nextParticipants.length !== prevParticipants.length) {
      updates.participants = nextParticipants;
    }

    if (Object.keys(updates).length === 0) continue;

    await taskRepository.updateTask(gid, taskId, updates);
    updatedCount += 1;
  }

  return updatedCount;
}

export async function syncAssignToAllTasksAndNotify(conversationId: string): Promise<void> {
  try {
    const updatedCount = await syncAssignToAllTasksAfterMembershipChange(conversationId);
    if (updatedCount > 0) {
      const gid = conversationId.trim();
      await emitToConversationAndMembers(gid, 'group:task_updated', {
        groupId: gid,
        conversationId: gid,
      });
    }
  } catch {
    /* không chặn luồng thêm/xóa thành viên */
  }
}
