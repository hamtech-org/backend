import type { TimestampFields } from '@/shared/types/common.types.js';

export type FriendStatus = 'pending' | 'accepted' | 'blocked';
export type GroupType = 'public' | 'private';
export type GroupMemberStatus = 'active' | 'pending' | 'kicked';
export type GroupMemberRole = 'owner' | 'admin' | 'member';

export interface IContact {
  userId: string;
  friendId: string;
  status: FriendStatus;
  requestedBy: string;
  createdAt: string;
}

export interface IGroup extends TimestampFields {
  groupId: string;
  name: string;
  description: string | null;
  avatar: string | null;
  type: GroupType;
  creatorId: string;
  memberCount: number;
  isApprovalRequired: boolean;
  conversationId: string | null;
}

export interface IGroupMember {
  groupId: string;
  userId: string;
  role: GroupMemberRole;
  status: GroupMemberStatus;
  joinedAt: string;
}

export interface ICreateGroupDto {
  name: string;
  description?: string;
  type: GroupType;
  isApprovalRequired?: boolean;
  memberIds?: string[];
}
