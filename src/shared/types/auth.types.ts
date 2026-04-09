export interface JwtAccessPayload {
  userId: string;
  email: string;
  role: 'user' | 'admin';
  sessionId: string;
}

export interface JwtRefreshPayload {
  userId: string;
  sessionId: string;
  tokenVersion: number;
}

export interface AuthenticatedRequest {
  user: JwtAccessPayload;
}
