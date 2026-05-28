import { Request, Response, NextFunction } from 'express';
import { AppError } from '@/shared/utils/errors.js';
import { logger } from '@/shared/utils/logger.js';

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.errorCode,
        message: err.message,
      },
    });
    return;
  }

  logger.error('Lỗi không xác định:', err);

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production'
        ? 'Lỗi hệ thống'
        : err.message,
    },
  });
};
