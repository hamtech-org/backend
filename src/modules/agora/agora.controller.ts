import { Request, Response, NextFunction } from 'express';
import { generateRtcToken } from './agora.service.js';
import { sendSuccess } from '@/shared/utils/response.js';
import { ValidationError } from '@/shared/utils/errors.js';
import { getRtcTokenSchema } from './agora.validator.js';

export const getRtcToken = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  try {
    const parsed = getRtcTokenSchema.safeParse({ query: req.query });
    if (!parsed.success) {
      throw new ValidationError('channelName là bắt buộc');
    }

    const { channelName } = parsed.data.query;
    const userId = req.user!.userId;

    const result = generateRtcToken(channelName, userId);
    sendSuccess(res, result, 'Tạo Agora token thành công');
  } catch (error) {
    next(error);
  }
};
