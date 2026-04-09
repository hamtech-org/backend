import type { TimestampFields } from '@/shared/types/common.types.js';
import type { UserStatus, UserRole, OAuthProvider } from '@/shared/types/user.types.js';

export interface IUser extends TimestampFields {
  userId: string;
  email: string;
  passwordHash: string;
  displayName: string;
  avatar: string | null;
  bio: string | null;
  phone: string | null;
  status: UserStatus;
  lastSeen: string | null;
  role: UserRole;
  isVerified: boolean;
  oauthProvider: OAuthProvider;
  oauthId: string | null;
  publicKey: string | null;
  settings: Record<string, unknown>;
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
}
