export type LiveSessionStatus = 'live' | 'ended';

export type LiveCategory = 'tech' | 'study' | 'entertainment' | 'sales' | 'chat' | 'other';

export type LiveCoverColor = 'blue' | 'green' | 'purple' | 'orange' | 'gray';

export interface ILiveSessionMeta {
  PK: string;
  SK: string;
  sessionId: string;
  channelName: string;
  hostUserId: string;
  title: string;
  category: LiveCategory;
  coverImageUrl?: string;
  coverColor?: LiveCoverColor;
  status: LiveSessionStatus;
  createdAt: string;
  startedAt: string;
  endedAt?: string;
  GSI1PK?: string;
  GSI1SK?: string;
  GSI2PK?: string;
  GSI2SK?: string;
}

export interface LiveSessionPublic {
  sessionId: string;
  channelName: string;
  title: string;
  hostUserId: string;
  status: LiveSessionStatus;
  startedAt: string;
  category: LiveCategory;
  coverImageUrl?: string;
  coverColor?: LiveCoverColor;
}

export interface LiveSessionListItem extends LiveSessionPublic {
  hostDisplayName: string;
  hostAvatar: string | null;
  viewerCount: number;
}

export interface CreateLiveSessionInput {
  title?: string;
  category?: LiveCategory;
  coverImageUrl?: string;
  coverColor?: LiveCoverColor;
}

export interface PatchLiveSessionInput {
  title?: string;
  category?: LiveCategory;
  coverImageUrl?: string;
  coverColor?: LiveCoverColor;
}
