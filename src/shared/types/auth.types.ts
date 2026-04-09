export interface JwtAccessPayload {
  userId: string;
  email: string;
  role: 'user' | 'admin';
}

export interface JwtRefreshPayload {
  userId: string;
  sessionId: string;
}

export interface AuthenticatedRequest {
  user: JwtAccessPayload;
}
