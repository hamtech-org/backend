import type { AiToolCall } from './ai-assistant.tools.js';

export const CONFIRM_REQUIRED_TOOLS = new Set(['search_users', 'search_users_contacts']);
const CONFIRM_PREFIX = '__AI_CONFIRM_TOOL__';

export function requiresToolConfirmation(toolName: string): boolean {
  return CONFIRM_REQUIRED_TOOLS.has(toolName);
}

export function isAffirmative(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /^(ok|oke|đồng ý|dong y|yes|y|confirm|xac nhan|xác nhận|thực hiện|thuc hien)\b/.test(
    normalized,
  );
}

export function isNegative(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /^(không|khong|no|n|hủy|huy|thôi|thoi|cancel|dừng|dung)\b/.test(normalized);
}

export function buildConfirmQuestion(toolName: string, args: Record<string, unknown>): string {
  if (toolName === 'search_users' || toolName === 'search_users_contacts') {
    const q = String(args.query ?? '').trim();
    const target = q ? ` "${q}"` : '';
    return `Bạn có muốn tôi tìm người dùng${target} không?`;
  }
  return 'Bạn có muốn tôi thực hiện thao tác này không?';
}

export function getConfirmActionFromPending(pending: {
  pendingId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
}) {
  return {
    type: 'confirm_tool' as const,
    payload: {
      pendingId: pending.pendingId,
      toolName: pending.toolName,
      question: buildConfirmQuestion(pending.toolName, pending.toolArgs ?? {}),
      confirmText: 'Đồng ý',
      cancelText: 'Không đồng ý',
      confirmToken: buildConfirmToken(pending.pendingId, 'approve'),
      cancelToken: buildConfirmToken(pending.pendingId, 'reject'),
    },
  };
}

export function pickFirstConfirmTool(calls: AiToolCall[]): AiToolCall | undefined {
  return calls.find((c) => requiresToolConfirmation(c.name));
}

export function buildConfirmToken(pendingId: string, decision: 'approve' | 'reject'): string {
  return `${CONFIRM_PREFIX}:${pendingId}:${decision}`;
}

export function parseConfirmToken(
  text: string,
): { pendingId: string; decision: 'approve' | 'reject' } | null {
  const normalized = text.trim();
  if (!normalized.startsWith(`${CONFIRM_PREFIX}:`)) return null;
  const parts = normalized.split(':');
  if (parts.length !== 3) return null;
  const pendingId = (parts[1] ?? '').trim();
  const decision = (parts[2] ?? '').trim();
  if (!pendingId) return null;
  if (decision !== 'approve' && decision !== 'reject') return null;
  return { pendingId, decision };
}
