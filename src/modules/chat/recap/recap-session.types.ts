export type GroupRecapSessionStatus = 'PENDING' | 'COMPLETED' | 'DISMISSED' | 'EXPIRED';

export type GroupRecapDismissReason = 'sent_message' | 'expired' | 'superseded' | 'manual';

export interface IGroupRecapSession {
  recapSessionId: string;
  conversationId: string;
  userId: string;
  fromMessageId: string;
  fromCreatedAt: string;
  fromSortKey: string;
  toMessageId: string;
  toCreatedAt: string;
  toSortKey: string;
  unreadCountAtOpen: number;
  capturedMessageCount: number;
  status: GroupRecapSessionStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  completedAt?: string;
  dismissedAt?: string;
  dismissReason?: GroupRecapDismissReason;
  unreadSummary?: string;
}
