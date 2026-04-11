export type CallType = 'audio' | 'video';

export interface CallInitiatePayload {
  calleeId: string;
  type: CallType;
}

export interface CallIncomingPayload {
  callerId: string;
  callerName: string;
  type: CallType;
  channelName: string;
}

export interface CallAcceptPayload {
  channelName: string;
  callerId: string;
}

export interface CallRejectPayload {
  channelName: string;
  callerId: string;
}

export interface CallEndPayload {
  channelName: string;
  peerId: string;
}
