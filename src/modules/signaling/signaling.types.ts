export type CallType = 'audio' | 'video';
export type CallStatus = 'ringing' | 'active' | 'ended' | 'rejected' | 'missed';

export interface ICallSession {
  callId: string;
  callerId: string;
  calleeId: string;
  type: CallType;
  status: CallStatus;
  startedAt: string | null;
  endedAt: string | null;
  duration: number | null;
}

export interface ICallOffer {
  callId: string;
  callerId: string;
  calleeId: string;
  type: CallType;
  sdp: string;
}

export interface ICallAnswer {
  callId: string;
  calleeId: string;
  sdp: string;
}

export interface IIceCandidate {
  callId: string;
  userId: string;
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}
