import { Request, Response, NextFunction } from 'express';
import { RtcRole } from 'agora-token';
import { generateRtcToken } from './agora.service.js';
import { sendSuccess } from '@/shared/utils/response.js';
import { ValidationError } from '@/shared/utils/errors.js';
import { getRtcTokenSchema } from './agora.validator.js';
import { liveAgoraService } from '@/modules/live/live.service.js';

export const getRtcToken = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const parsed = getRtcTokenSchema.safeParse({ query: req.query });
    if (!parsed.success) {
      throw new ValidationError('channelName là bắt buộc');
    }

    const { channelName, role: roleQuery } = parsed.data.query;
    const userId = req.user!.userId;

    const isLiveChannel = channelName.startsWith('live_');

    let rtcRole = RtcRole.PUBLISHER;
    if (roleQuery === 'subscriber') {
      rtcRole = RtcRole.SUBSCRIBER;
    }

    if (isLiveChannel) {
      if (rtcRole === RtcRole.SUBSCRIBER) {
        await liveAgoraService.assertSubscriberToken(channelName);
      } else {
        await liveAgoraService.assertPublisherToken(channelName, userId);
      }
    } else if (roleQuery === 'subscriber') {
      throw new ValidationError('subscriber role chỉ dùng cho kênh live');
    }

    const result = generateRtcToken(channelName, userId, rtcRole);
    sendSuccess(res, result, 'Tạo Agora token thành công');
  } catch (error) {
    next(error);
  }
};
