import type { TimestampFields } from '@/shared/types/common.types.js';
import type { ILocationInfo } from '@/shared/utils/geolocation.js';

// ─── Session ───

export interface ISession extends TimestampFields {
  sessionId: string;
  userId: string;

  refreshTokenHash?: string;

  deviceInfo: {
    userAgent: string;
    os?: string;
    browser?: string;
  };

  ipAddress: string;
  location: ILocationInfo | null;

  expiresAt: number;
  isRevoked: boolean;
}

/** Phiên trả về client (không có refreshTokenHash) */
export interface IAuthSessionSummary {
  sessionId: string;
  deviceInfo: ISession['deviceInfo'];
  ipAddress: string;
  location: ISession['location'];
  expiresAt: number;
  isRevoked: boolean;
  createdAt: string;
  updatedAt: string;
  /** Trùng session trong JWT hiện tại */
  isCurrent: boolean;
  /** Refresh token còn dùng được (chưa thu hồi, chưa hết hạn) */
  isActive: boolean;
}

// ─── DTOs ───

export interface IRegisterDto {
  email: string;
  password: string;
  displayName: string;
}

export interface ILoginDto {
  email: string;
  password: string;
}

export interface IRequestMeta {
  ipAddress: string;
  userAgent: string;
}

export interface IFaceLoginDto {
  email: string; // Email phải khớp với face được nhận diện
  image: string; // base64 encoded image
  livenessSessionId: string; // Session ID từ face liveness check
}

export interface IEnableFaceLoginDto {
  image: string; // base64 encoded image
  livenessSessionId: string; // Session ID từ face liveness check
}

export interface ILivenessSessionResponse {
  sessionId: string;
}

export interface ILivenessResultDto {
  sessionId: string;
  confidence: number; // 0-100
  isLive: boolean;
}

// ─── Responses ───

export interface IAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface ILoginResponse extends IAuthTokens {
  userId: string;
}
