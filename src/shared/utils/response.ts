import { Response } from 'express';
import type { PaginationMeta, ApiSuccessResponse } from '@/shared/types/common.types.js';

export const sendSuccess = <T>(
  res: Response,
  data: T,
  message: string = 'Thành công',
  statusCode: number = 200,
  pagination?: PaginationMeta,
): void => {
  const response: ApiSuccessResponse<T> = { success: true, data, message };
  if (pagination) {
    response.pagination = pagination;
  }
  res.status(statusCode).json(response);
};

export const sendCreated = <T>(
  res: Response,
  data: T,
  message: string = 'Tạo thành công',
): void => {
  sendSuccess(res, data, message, 201);
};
