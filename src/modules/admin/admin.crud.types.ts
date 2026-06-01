import type { UserRole } from '@/shared/types/user.types.js';
import type {
  CommunityCategory,
  CommunityJoinPolicy,
  CommunityStatus,
  CommunityType,
} from '@/modules/community/community.types.js';
import type { PostVisibility } from '@/modules/newsfeed/newsfeed.types.js';

export type AdminPostDisplayStatus = 'visible' | 'hidden' | 'flagged';
export type AdminGroupStatus = CommunityStatus;

export interface AdminListQuery {
  query?: string;
  role?: UserRole;
  status?: AdminGroupStatus | AdminPostDisplayStatus;
  limit?: number;
  cursor?: string;
}

export interface AdminUserListItem {
  userId: string;
  email: string;
  displayName: string;
  avatar: string | null;
  role: UserRole;
  status: string;
  isVerified: boolean;
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
}

export interface AdminGroupListItem {
  groupId: string;
  name: string;
  description?: string;
  avatar?: string;
  ownerId: string;
  ownerDisplayName?: string;
  memberCount: number;
  status: AdminGroupStatus;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
}

export interface AdminPostListItem {
  postId: string;
  title: string;
  content: string;
  authorId: string;
  authorDisplayName?: string;
  visibility: PostVisibility;
  status: AdminPostDisplayStatus;
  likes: number;
  comments: number;
  shares: number;
  views: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminListResult<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CreateAdminUserDto {
  email: string;
  password: string;
  displayName: string;
  role?: UserRole;
}

export interface UpdateAdminUserDto {
  displayName?: string;
  email?: string;
  avatar?: string | null;
}

export interface CreateAdminGroupDto {
  name: string;
  slug?: string;
  description?: string;
  ownerId: string;
  memberIds?: string[];
  category?: CommunityCategory;
  type?: CommunityType;
  joinPolicy?: CommunityJoinPolicy;
}

export interface UpdateAdminGroupDto {
  name?: string;
  description?: string;
  avatar?: string;
  status?: AdminGroupStatus;
}

export interface CreateAdminPostDto {
  content: string;
  visibility?: PostVisibility;
  status?: AdminPostDisplayStatus;
}

export interface UpdateAdminPostDto {
  content?: string;
  visibility?: PostVisibility;
  status?: AdminPostDisplayStatus;
}
