import { v4 as uuidv4 } from 'uuid';
import type { ModerationStatus } from '@/modules/newsfeed/newsfeed.types.js';
import type { GroupAdminStatus } from '@/modules/chat/shared/chat.types.js';
import type { AdminPostDisplayStatus } from './admin.crud.types.js';
import { adminRepository } from './admin.repository.js';
import type { ModerationAction, ModerationTarget } from './admin.types.js';

export function encodeAdminCursor(key: Record<string, unknown> | undefined): string | null {
  if (!key) return null;
  return Buffer.from(JSON.stringify(key)).toString('base64url');
}

export function decodeAdminCursor(cursor?: string): Record<string, unknown> | undefined {
  if (!cursor?.trim()) return undefined;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function resolveGroupStatus(conv: {
  groupStatus?: GroupAdminStatus;
  groupSettings?: { adminStatus?: GroupAdminStatus };
}): GroupAdminStatus {
  return conv.groupStatus ?? conv.groupSettings?.adminStatus ?? 'active';
}

export function toAdminPostStatus(moderationStatus: ModerationStatus): AdminPostDisplayStatus {
  if (moderationStatus === 'approved') return 'visible';
  if (moderationStatus === 'rejected') return 'hidden';
  return 'flagged';
}

export function fromAdminPostStatus(status: AdminPostDisplayStatus): ModerationStatus {
  if (status === 'visible') return 'approved';
  if (status === 'hidden') return 'rejected';
  return 'pending';
}

export async function writeModerationLog(
  adminId: string,
  targetType: ModerationTarget,
  targetId: string,
  action: ModerationAction,
  reason: string,
): Promise<void> {
  const now = new Date().toISOString();
  await adminRepository.createModerationLog({
    logId: uuidv4(),
    adminId,
    targetType,
    targetId,
    action,
    reason,
    createdAt: now,
  });
}
