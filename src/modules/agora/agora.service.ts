import { RtcTokenBuilder, RtcRole } from 'agora-token';
import { env } from '@/config/env.js';
import crypto from 'crypto';

/**
 * Chuyển userId (UUID string) thành Agora uid (uint32).
 * Agora yêu cầu uid là số nguyên 32-bit không dấu.
 */
export const userIdToAgoraUid = (userId: string): number => {
  const hash = crypto.createHash('md5').update(userId).digest();
  return hash.readUInt32BE(0);
};

export const generateRtcToken = (
  channelName: string,
  userId: string,
): { token: string; uid: number; channel: string } => {
  const uid = userIdToAgoraUid(userId);
  const role = RtcRole.PUBLISHER;
  const tokenExpirationInSeconds = 3600;
  const privilegeExpirationInSeconds = 3600;

  const token = RtcTokenBuilder.buildTokenWithUid(
    env.AGORA_APP_ID,
    env.AGORA_APP_CERTIFICATE,
    channelName,
    uid,
    role,
    tokenExpirationInSeconds,
    privilegeExpirationInSeconds,
  );

  return { token, uid, channel: channelName };
};
