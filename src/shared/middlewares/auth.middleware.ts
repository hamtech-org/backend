import { Request, Response, NextFunction } from 'express';
import jsonwebtoken from 'jsonwebtoken';
import { env } from '@/config/env.js';
import { logger } from '@/shared/utils/logger.js';
import { UnauthorizedError, ForbiddenError } from '@/shared/utils/errors.js';
import type { JwtAccessPayload } from '@/shared/types/auth.types.js';

const { verify } = jsonwebtoken;

declare global {
  namespace Express {
    interface Request {
      user?: JwtAccessPayload;
    }
  }
}

export const authenticate = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    logger.debug(`[AUTH] Authorization header: ${authHeader ? '✓ present' : '✗ missing'}`);

    const token = authHeader?.split(' ')[1];
    if (!token) {
      logger.warn(`[AUTH] No token found in Authorization header`);
      throw new UnauthorizedError('Token không được cung cấp');
    }

    logger.debug(`[AUTH] Token found, length: ${token.length}`);
    logger.debug(`[AUTH] Using secret: ${env.JWT_ACCESS_SECRET.substring(0, 20)}...`);

    const decoded = verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
    }) as JwtAccessPayload;

    logger.debug(`[AUTH] Token verified successfully for user: ${decoded.userId}`);
    req.user = decoded;
    next();
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`[AUTH] Token verification failed: ${errorMsg}`);
    
    if (error instanceof jsonwebtoken.TokenExpiredError) {
      logger.warn(`[AUTH] Token expired`);
      next(new UnauthorizedError('Token đã hết hạn'));
      return;
    }
    if (error instanceof jsonwebtoken.JsonWebTokenError) {
      logger.warn(`[AUTH] Invalid token: ${error.message}`);
    }
    next(new UnauthorizedError('Token không hợp lệ'));
  }
};

export const authorize = (...roles: string[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      next(new ForbiddenError());
      return;
    }
    next();
  };
};
