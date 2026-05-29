import type { TimestampFields } from '@/shared/types/common.types.js';

export type FriendStatus = 'pending' | 'accepted' | 'blocked';
export type GroupType = 'public' | 'private';
export type GroupMemberStatus = 'active' | 'pending' | 'kicked';
export type GroupMemberRole = 'owner' | 'admin' | 'moderator' | 'member';
export type CommunityCategory =
  | 'general'
  | 'technology'
  | 'sports'
  | 'music'
  | 'education'
  | 'gaming'
  | 'lifestyle';

export interface IGroupRule {
  id: string;
  title: string;
  description: string;
}

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
  coverUrl?: string | null;
  slug?: string;
  category?: CommunityCategory;
  rules?: IGroupRule[];
  type: GroupType;
  joinPolicy?: 'open' | 'approval';
  creatorId: string;
  ownerId?: string;
  memberCount: number;
  postCount?: number;
  popularityScore?: number;
  isApprovalRequired: boolean;
  conversationId: string | null;
  isActive?: boolean;
  status?: 'active' | 'archived';
  deletedAt?: string;
  deletedBy?: string;
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
