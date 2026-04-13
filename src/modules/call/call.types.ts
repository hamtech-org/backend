export type CallType = 'audio' | 'video';

export interface CallInitiatePayload {
  calleeId: string;
  type: CallType;
  conversationId: string;
}

export interface CallIncomingPayload {
  callerId: string;
  callerName: string;
  type: CallType;
  channelName: string;
  conversationId: string;
}

export interface CallAcceptPayload {
  channelName: string;
  callerId: string;
  conversationId: string;
  type: CallType;
}

export interface CallRejectPayload {
  channelName: string;
  callerId: string;
  conversationId: string;
  type: CallType;
}

export interface CallEndPayload {
  channelName: string;
  peerId: string;
  conversationId: string;
  type: CallType;
  durationSec?: number;
  result?: 'completed' | 'missed' | 'rejected';
}

export interface CallMissedPayload {
  channelName: string;
  peerId: string;
  conversationId: string;
  type: CallType;
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
