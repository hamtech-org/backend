import { taskRepository } from './task.repository.js';
import { taskService } from './task.service.js';
import { logger } from '@/shared/utils/logger.js';

let started = false;

function parseDueDateToMs(raw: unknown): number {
  const s = String(raw ?? '').trim();
  if (!s) return NaN;
  const ms = new Date(s).getTime();
  if (Number.isFinite(ms)) return ms;
  const m =
    s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/) ??
    s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!m) return NaN;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const hh = m[4] ? Number(m[4]) : 0;
  const mm = m[5] ? Number(m[5]) : 0;
  const year = m[0].startsWith(String(a)) && String(a).length === 4 ? a : c;
  const month = b;
  const day = m[0].startsWith(String(a)) && String(a).length === 4 ? c : a;
  const d = new Date(year, Math.max(0, month - 1), day, hh, mm, 0, 0);
  const out = d.getTime();
  return Number.isFinite(out) ? out : NaN;
}

export function startTaskDueReminderJob(): void {
  if (started) return;
  started = true;

  const intervalMs = 30_000;
  const maxOverdueMs = 24 * 60 * 60_000; // send up to 24h late (anti-miss)

  const tick = async () => {
    const now = new Date();
    const toMs = now.getTime();
    const fromMs = toMs - maxOverdueMs;

    try {
      const rows = await taskRepository.scanDueTasksCandidates();
      if (!rows || rows.length === 0) return;
      let minDueMs = Number.POSITIVE_INFINITY;
      let dueNowCount = 0;
      for (const r of rows) {
        const dueRaw = (r as any)?.dueDate;
        const dm = parseDueDateToMs(dueRaw);
        if (!Number.isFinite(dm)) continue;
        if (dm < minDueMs) minDueMs = dm;
        if (dm <= toMs && dm >= fromMs) dueNowCount++;
      }
      logger.debug(
        `[taskDueReminderJob] candidates=${rows.length} dueNow=${dueNowCount} nextDue=${Number.isFinite(minDueMs) ? new Date(minDueMs).toISOString() : 'n/a'}`,
      );

      for (const row of rows) {
        const conversationId = String((row as any)?.conversationId ?? '').trim();
        const taskId = String((row as any)?.taskId ?? '').trim();
        if (!conversationId || !taskId) continue;

        const dueRaw = (row as any)?.dueDate;
        const dueMs = parseDueDateToMs(dueRaw);
        if (!Number.isFinite(dueMs)) continue;
        // Send once anytime from due time up to 24h overdue.
        if (dueMs > toMs) continue;
        if (dueMs < fromMs) continue;

        const actorId = String((row as any)?.creatorId ?? '').trim();
        const requesterId = actorId || 'system';
        try {
          logger.info(`[taskDueReminderJob] due now conv=${conversationId} task=${taskId}`);
          const r = await taskService.broadcastDueReminder(requesterId, conversationId, taskId, {
            skipMemberCheck: true,
            senderIdOverride: actorId || null,
          });
          logger.info(
            `[taskDueReminderJob] broadcast result conv=${conversationId} task=${taskId} sent=${String((r as any)?.sent)}`,
          );
        } catch {
          /* ignore per-task */
        }
      }
    } catch (err) {
      logger.warn('[taskDueReminderJob] scan failed', err as any);
    }
  };

  // fire-and-forget loop
  void tick();
  setInterval(() => void tick(), intervalMs);
  logger.info('[taskDueReminderJob] started');
}

