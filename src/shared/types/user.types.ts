export type UserStatus = 'online' | 'offline' | 'away';
export type UserRole = 'user' | 'admin';
export type OAuthProvider = 'local' | 'google' | 'facebook';

export interface IUserBase {
  userId: string;
  email: string;
  displayName: string;
  avatar: string | null;
  bio: string | null;
  phone: string | null;
  status: UserStatus;
  role: UserRole;
  isVerified: boolean;
  oauthProvider: OAuthProvider;
  publicKey: string | null;
  createdAt: string;
  updatedAt: string;
}
