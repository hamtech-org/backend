import { Request, Response, NextFunction } from 'express';
import jsonwebtoken from 'jsonwebtoken';
import { env } from '@/config/env.js';
import type { JwtAccessPayload } from '@/shared/types/auth.types.js';

const { verify } = jsonwebtoken;

/** Gắn req.user nếu có Bearer token hợp lệ; không có token vẫn cho qua. */
export const authenticateOptional = (req: Request, _res: Response, next: NextFunction): void => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    next();
    return;
  }
  try {
    const decoded = verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
    }) as JwtAccessPayload;
    req.user = decoded;
  } catch {
    /* ignore invalid token for optional auth */
  }
  next();
};
