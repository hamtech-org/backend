type CallMessageKind = 'completed' | 'missed' | 'rejected' | 'cancelled';
type CallMessageType = 'audio' | 'video';

interface CallMessagePayload {
  kind?: string;
  callType?: string;
  durationSec?: unknown;
}

function callTypeLabel(callType: string | undefined): string {
  return callType === 'video' ? 'Cuộc gọi video' : 'Cuộc gọi thoại';
}

function normalizeDurationSec(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function formatCallDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} giây`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) return `${minutes} phút`;
  return `${minutes} phút ${remainingSeconds} giây`;
}

function normalizeCallKind(kind: string | undefined): CallMessageKind {
  if (kind === 'missed' || kind === 'rejected' || kind === 'cancelled') return kind;
  return 'completed';
}

function normalizeCallType(callType: string | undefined): CallMessageType {
  return callType === 'video' ? 'video' : 'audio';
}

export function formatCallMessagePreview(content: string | null | undefined): string {
  const raw = String(content ?? '').trim();
  if (!raw) return 'Cuộc gọi';

  let payload: CallMessagePayload;
  try {
    payload = JSON.parse(raw) as CallMessagePayload;
  } catch {
    return 'Cuộc gọi';
  }

  const kind = normalizeCallKind(payload.kind);
  const callType = normalizeCallType(payload.callType);
  const durationSec = normalizeDurationSec(payload.durationSec);

  if (kind === 'missed') return 'Cuộc gọi nhỡ';
  if (kind === 'rejected') return 'Cuộc gọi bị từ chối';
  if (kind === 'cancelled') return 'Cuộc gọi đã hủy';

  const label = callTypeLabel(callType);
  return durationSec > 0 ? `${label} - ${formatCallDuration(durationSec)}` : label;
}
