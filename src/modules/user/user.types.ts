import type { TimestampFields } from '@/shared/types/common.types.js';
import type { UserStatus, UserRole, OAuthProvider } from '@/shared/types/user.types.js';
import type { Express } from 'express';

export interface IUser extends TimestampFields {
  userId: string;
  email: string;
  passwordHash: string;

  displayName: string;
  avatar: string | null;
  bio: string | null;

  phone: string | null;

  status: UserStatus;
  role: UserRole;

  isVerified: boolean;
  lastSeen: string | null;

  tokenVersion: number;

  faceLoginEnabled: boolean;
  rekognitionFaceId: string | null;

  oauthProvider?: OAuthProvider;
  oauthId?: string | null;

  settings: Record<string, unknown>;

  /** Soft-delete (admin). */
  isDeleted?: boolean;

  GSI1PK?: string;
  GSI1SK?: string;
}

export interface IUserPublic {
  userId: string;
  displayName: string;
  avatar: string | null;
  bio: string | null;
  status: UserStatus;
  lastSeen: string | null;
}

export interface IUpdateProfileDto {
  displayName?: string;
  bio?: string;
  avatar?: string;
  phone?: string;
  avatarFile?: Express.Multer.File;
  status?: 'online' | 'offline' | 'away';
  lastSeen?: string;
}

export interface IFriendship {
  userId: string;
  friendId: string;
  status: 'friend' | 'pending' | 'blocked';
  createdAt: string;
  updatedAt: string;
}

export interface IFriendRequest {
  senderId: string;
  receiverId: string;
  status: 'pending' | 'accepted' | 'rejected' | 'blocked';
  createdAt: string;
  updatedAt: string;
}

export interface IFriendshipResponse {
  userId: string;
  displayName: string;
  avatar: string | null;
  bio: string | null;
  status: 'friend' | 'pending' | 'blocked';
  createdAt: string;
}

export interface IFriendRequestResponse {
  userId: string;
  displayName: string;
  avatar: string | null;
  bio: string | null;
  requestStatus: 'sent' | 'received'; // 'sent' nếu user gửi request, 'received' nếu user nhận
  status: 'pending' | 'accepted' | 'rejected' | 'blocked';
  createdAt: string;
}

export interface IFriendsList {
  userId: string;
  friends: IFriendshipResponse[];
  total: number;
}

export interface IPendingRequests {
  received: IFriendRequestResponse[]; // Requests người dùng nhận
  sent: IFriendRequestResponse[]; // Requests người dùng gửi
}

export interface IUserStats {
  userId: string;
  displayName: string;
  avatar: string | null;
  followersCount: number;
  followingCount: number;
  postsCount: number;
}

export interface ISearchUserQuery {
  q: string;
  limit?: number;
  offset?: number;
}
