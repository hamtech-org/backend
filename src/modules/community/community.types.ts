import type { IPost } from '@/modules/newsfeed/newsfeed.types.js';

export const COMMUNITY_CATEGORIES = [
  'general',
  'technology',
  'sports',
  'music',
  'education',
  'gaming',
  'lifestyle',
] as const;

export type CommunityCategory = (typeof COMMUNITY_CATEGORIES)[number];
export type CommunityType = 'public' | 'private';
export type CommunityJoinPolicy = 'open' | 'approval';
export type CommunityStatus = 'active' | 'archived';
export type CommunityMemberRole = 'owner' | 'admin' | 'moderator' | 'member';
export type CommunityMemberStatus = 'active' | 'banned';
export type CommunityRequestStatus = 'pending' | 'approved' | 'rejected';
export type CommunityContentType = 'post';

export interface ICommunityRule {
  id: string;
  title: string;
  description: string;
}

export interface ICommunity {
  groupId: string;
  communityId: string;
  name: string;
  slug: string;
  description: string | null;
  avatar: string | null;
  coverUrl: string | null;
  category: CommunityCategory;
  rules?: ICommunityRule[];
  type: CommunityType;
  joinPolicy: CommunityJoinPolicy;
  creatorId: string;
  ownerId: string;
  memberCount: number;
  postCount: number;
  popularityScore: number;
  isApprovalRequired: boolean;
  isPostApprovalRequired: boolean;
  conversationId: string | null;
  chatEnabled: boolean;
  isActive: boolean;
  status: CommunityStatus;
  createdAt: string;
  createdAtMs: number;
  updatedAt: string;
  deletedAt?: string;
  deletedBy?: string;
  viewerRole?: CommunityMemberRole | null;
  viewerStatus?: CommunityMemberStatus | null;
  joinRequestStatus?: CommunityRequestStatus | null;
  pinnedPostIds?: string[];
}

export interface ICommunityMember {
  groupId: string;
  communityId: string;
  userId: string;
  role: CommunityMemberRole;
  status: CommunityMemberStatus;
  joinedAt: string;
  joinedAtMs: number;
  GSI1PK?: string;
  GSI1SK?: string;
}

export interface ICommunityJoinRequest {
  groupId: string;
  communityId: string;
  userId: string;
  status: CommunityRequestStatus;
  requestedAt: string;
  requestedAtMs: number;
  resolvedAt?: string;
  resolvedBy?: string;
  message?: string;
}

export interface ICommunityPendingRequest {
  groupId: string;
  communityId: string;
  userId: string;
  requestedAt: string;
  requestedAtMs: number;
  message?: string;
}

export interface ICommunityContentIndex {
  groupId: string;
  communityId: string;
  contentType: CommunityContentType;
  contentId: string;
  authorId: string;
  createdAt: string;
  createdAtMs: number;
}

export interface ICreateCommunityDto {
  name: string;
  slug?: string;
  description?: string | null;
  avatar?: string | null;
  coverUrl?: string | null;
  category?: CommunityCategory;
  rules?: ICommunityRule[];
  type: CommunityType;
  joinPolicy?: CommunityJoinPolicy;
  isPostApprovalRequired?: boolean;
}

export interface IUpdateCommunityDto {
  name?: string;
  slug?: string;
  description?: string | null;
  avatar?: string | null;
  coverUrl?: string | null;
  category?: CommunityCategory;
  rules?: ICommunityRule[];
  type?: CommunityType;
  joinPolicy?: CommunityJoinPolicy;
  isPostApprovalRequired?: boolean;
  chatEnabled?: boolean;
}

export interface IListCommunitiesQuery {
  category?: CommunityCategory;
  scope?: 'discover' | 'joined';
  limit?: number;
  cursor?: string;
}

export interface IJoinCommunityDto {
  message?: string;
}

export interface IResolveJoinRequestDto {
  action: 'approve' | 'reject';
}

export interface IUpdateMemberRoleDto {
  role: Exclude<CommunityMemberRole, 'owner'>;
}

export interface ITransferOwnerDto {
  targetUserId: string;
}

export interface ICommunityListPage {
  items: ICommunity[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ICommunityPostsPage {
  items: IPost[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface IJoinCommunityResult {
  status: 'joined' | 'requested' | 'already_member' | 'already_pending';
  community: ICommunity;
}

export type CommunityModerationAction =
  | 'approve_join'
  | 'reject_join'
  | 'ban_member'
  | 'unban_member'
  | 'change_role'
  | 'transfer_ownership'
  | 'approve_post'
  | 'reject_post'
  | 'delete_post'
  | 'pin_post'
  | 'unpin_post'
  | 'update_settings';

export type CommunityModerationTargetType = 'member' | 'post' | 'community';

export interface ICommunityModerationLog {
  groupId: string;
  communityId: string;
  logId: string;
  actorId: string;
  action: CommunityModerationAction;
  targetId: string;
  targetType: CommunityModerationTargetType;
  targetName?: string;
  reason?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  createdAtMs: number;
  actorInfo?: {
    userId: string;
    displayName: string;
    avatar: string | null;
  };
  targetUserInfo?: {
    userId: string;
    displayName: string;
    avatar: string | null;
  };
}

export interface ICommunityModerationLogsPage {
  items: ICommunityModerationLog[];
  nextCursor: string | null;
  hasMore: boolean;
}
