import type { AiToolCall } from './execute-tools.js';
import { requiresToolConfirmation as registryRequiresConfirmation } from './tool-registry.js';

const CONFIRM_PREFIX = '__AI_CONFIRM_TOOL__';
export const BATCH_CONFIRM_TOOL_NAME = '__batch_confirmed_tools';

export function requiresToolConfirmation(toolName: string): boolean {
  return registryRequiresConfirmation(toolName);
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
  if (toolName === BATCH_CONFIRM_TOOL_NAME) {
    const calls = getPendingConfirmedToolCalls({ toolName, toolArgs: args });
    const userSearchQueries = calls
      .filter((call) => call.name === 'search_users' || call.name === 'search_users_contacts')
      .map((call) => String(call.args.query ?? '').trim())
      .filter(Boolean);
    if (userSearchQueries.length > 0) {
      return `Bạn có muốn tôi tìm người dùng ${userSearchQueries.map((q) => `"${q}"`).join(', ')} không?`;
    }
    return `Bạn có muốn tôi thực hiện ${calls.length} thao tác này không?`;
  }
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

export function pickConfirmTools(calls: AiToolCall[]): AiToolCall[] {
  return calls.filter((c) => requiresToolConfirmation(c.name));
}

export function buildPendingConfirmedTools(calls: AiToolCall[]): {
  toolName: string;
  toolArgs: Record<string, unknown>;
} {
  if (calls.length === 1) {
    const only = calls[0]!;
    return { toolName: only.name, toolArgs: only.args ?? {} };
  }
  return {
    toolName: BATCH_CONFIRM_TOOL_NAME,
    toolArgs: {
      calls: calls.map((call) => ({
        name: call.name,
        args: call.args ?? {},
      })),
    },
  };
}

export function getPendingConfirmedToolCalls(pending: {
  toolName: string;
  toolArgs: Record<string, unknown>;
}): AiToolCall[] {
  if (pending.toolName !== BATCH_CONFIRM_TOOL_NAME) {
    return [{ name: pending.toolName, args: pending.toolArgs ?? {} }];
  }
  const rawCalls = Array.isArray(pending.toolArgs?.calls) ? pending.toolArgs.calls : [];
  return rawCalls
    .map((raw) => {
      const item = raw as { name?: unknown; args?: unknown };
      return {
        name: String(item.name ?? '').trim(),
        args:
          item.args && typeof item.args === 'object' ? (item.args as Record<string, unknown>) : {},
      };
    })
    .filter((call) => call.name.length > 0);
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
