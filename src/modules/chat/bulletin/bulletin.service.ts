import { conversationRepository } from '../conversation/conversation.repository.js';
import { pollService } from '../poll/poll.service.js';
import { taskService } from '../task/task.service.js';
import { ForbiddenError } from '@/shared/utils/errors.js';

function stripDynamoKeys(row: Record<string, unknown>): Record<string, unknown> {
  const { PK: _pk, SK: _sk, ...rest } = row;
  return rest;
}

export type BulletinFeedItem =
  | { kind: 'poll'; createdAt: string; data: Record<string, unknown> }
  | { kind: 'task'; createdAt: string; data: Record<string, unknown> };

export const bulletinService = {
  /**
   * Lịch sử bảng tin nhóm: bình chọn + công việc, sắp xếp mới → cũ.
   * Đã gộp enrich creatorDisplayName (từ poll/task service) và bỏ PK/SK Dynamo.
   */
  getBulletinFeed: async (requesterId: string, conversationId: string): Promise<{ items: BulletinFeedItem[] }> => {
    const member = await conversationRepository.getMember(conversationId, requesterId);
    if (!member) throw new ForbiddenError('Bạn không thuộc nhóm');

    const [polls, tasks] = await Promise.all([
      pollService.getPolls(conversationId),
      taskService.getTasks(conversationId),
    ]);

    const items: BulletinFeedItem[] = [];

    for (const p of polls) {
      const row = p as Record<string, unknown>;
      const createdAt = String(row.createdAt ?? row.updatedAt ?? '');
      items.push({ kind: 'poll', createdAt, data: stripDynamoKeys(row) });
    }
    for (const t of tasks) {
      const row = t as Record<string, unknown>;
      const createdAt = String(row.createdAt ?? row.updatedAt ?? '');
      items.push({ kind: 'task', createdAt, data: stripDynamoKeys(row) });
    }

    const rowId = (it: BulletinFeedItem) =>
      String(it.kind === 'poll' ? it.data.pollId ?? '' : it.data.taskId ?? '');

    items.sort((a, b) => {
      const ta = Date.parse(a.createdAt) || 0;
      const tb = Date.parse(b.createdAt) || 0;
      if (tb !== ta) return tb - ta;
      return `${a.kind}-${rowId(a)}`.localeCompare(`${b.kind}-${rowId(b)}`);
    });

    return { items };
  },
};
