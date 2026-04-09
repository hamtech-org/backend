import type { TimestampFields } from '@/shared/types/common.types.js';

export interface ISession extends TimestampFields {
  sessionId: string;
  userId: string;
  refreshToken: string;
  deviceInfo: string;
  ipAddress: string;
  expiresAt: number;
}

export interface IRegisterDto {
  email: string;
  password: string;
  displayName: string;
}

export interface ILoginDto {
  email: string;
  password: string;
}

export interface IAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface ILoginResponse extends IAuthTokens {
  userId: string;
}
