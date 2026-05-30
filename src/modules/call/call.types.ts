export type CallType = 'audio' | 'video';

export type CallScope = 'direct' | 'group';

export interface CallInitiatePayload {
  type: CallType;
  conversationId: string;
  /** Mặc định `direct` — cần `calleeId`. Với `group` bỏ qua `calleeId`, server mời mọi thành viên nhóm. */
  scope?: CallScope;
  calleeId?: string;
}

export interface CallIncomingPayload {
  callerId: string;
  callerName: string;
  type: CallType;
  channelName: string;
  conversationId: string;
  scope?: CallScope;
  hostId?: string;
  sessionId?: string;
}

export interface CallAcceptPayload {
  channelName: string;
  callerId: string;
  conversationId: string;
  type: CallType;
  sessionId?: string;
}

export interface CallRejectPayload {
  channelName: string;
  callerId: string;
  conversationId: string;
  type: CallType;
  sessionId?: string;
}

export interface CallEndPayload {
  channelName: string;
  peerId: string;
  conversationId: string;
  type: CallType;
  sessionId?: string;
  durationSec?: number;
  result?: 'completed' | 'missed' | 'rejected' | 'cancelled';
}

export interface CallMissedPayload {
  channelName: string;
  peerId: string;
  conversationId: string;
  type: CallType;
  sessionId?: string;
}

export interface CallUpgradeRequestPayload {
  peerId: string;
  channelName: string;
}

export interface CallUpgradeResponsePayload {
  peerId: string;
  channelName: string;
  accepted: boolean;
}

/** Thành viên rời cuộc gọi nhóm (Agora vẫn tiếp tục cho người khác). */
export interface CallGroupLeavePayload {
  channelName: string;
  conversationId: string;
}

/** Host kết thúc cuộc gọi nhóm cho tất cả. */
export interface CallGroupEndAllPayload {
  channelName: string;
  conversationId: string;
  type: CallType;
  durationSec?: number;
}

/** Host hủy / timeout khi chưa ai nhấc máy — đóng modal phía thành viên. */
export interface CallGroupMissedPayload {
  channelName: string;
  conversationId: string;
  type: CallType;
  sessionId?: string;
}

/** Client báo không còn ai trong kênh Agora (phiên nhóm kết thúc tự nhiên). */
export interface CallGroupVacantPayload {
  channelName: string;
  conversationId: string;
}

/** Client đã vào kênh Agora nhóm — server đánh dấu user busy cho gọi 1-1. */
export interface CallGroupRtcJoinedPayload {
  channelName: string;
  conversationId: string;
}

/** Client rời RTC nhóm (đóng CallPage / mất kết nối) — bỏ đánh dấu busy. */
export interface CallGroupRtcLeftPayload {
  channelName: string;
  conversationId: string;
}
