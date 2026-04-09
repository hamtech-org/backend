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
  role: UserRole;

  isVerified: boolean;
  lastSeen: string | null;

  tokenVersion: number; 

  faceLoginEnabled: boolean;
  rekognitionFaceId: string | null;

  oauthProvider?: OAuthProvider;
  oauthId?: string | null;

  settings: Record<string, unknown>;

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
}
