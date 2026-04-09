import { Request, Response, NextFunction } from 'express';
import jsonwebtoken from 'jsonwebtoken';
import { env } from '@/config/env.js';
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
    const token = authHeader?.split(' ')[1];

    if (!token) {
      throw new UnauthorizedError('Token không được cung cấp');
    }

    const decoded = verify(token, env.JWT_PUBLIC_KEY, {
      algorithms: ['RS256'],
    }) as JwtAccessPayload;

    req.user = decoded;
    next();
  } catch (error) {
    if (error instanceof jsonwebtoken.TokenExpiredError) {
      next(new UnauthorizedError('Token đã hết hạn'));
      return;
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
