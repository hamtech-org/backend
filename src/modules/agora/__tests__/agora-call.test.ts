import { generateRtcToken, userIdToAgoraUid } from '../agora.service.js';
import { env } from '@/config/env.js';

describe('Agora Service - RTC Token Generation Unit Tests', () => {
  const userId = 'user-123';
  const channelName = 'room-456';

  it('TC01 (Pass): should successfully convert UUID to 32-bit uint32 uid', () => {
    const uid = userIdToAgoraUid(userId);
    expect(typeof uid).toBe('number');
    expect(uid).toBeGreaterThan(0);
  });

  it('TC02 (Pass): should generate a non-empty RTC token', () => {
    // Temporarily set env variables if not set
    const origAppId = env.AGORA_APP_ID;
    const origAppCert = env.AGORA_APP_CERTIFICATE;
    env.AGORA_APP_ID = env.AGORA_APP_ID || 'dummy-app-id';
    env.AGORA_APP_CERTIFICATE = env.AGORA_APP_CERTIFICATE || 'dummy-cert';

    const result = generateRtcToken(channelName, userId);

    expect(result).toHaveProperty('token');
    expect(result.token.length).toBeGreaterThan(0);
    expect(result.uid).toBe(userIdToAgoraUid(userId));
    expect(result.channel).toBe(channelName);

    env.AGORA_APP_ID = origAppId;
    env.AGORA_APP_CERTIFICATE = origAppCert;
  });

  it('TC03 (Pass): generateRtcToken should still return a token if channelName is empty', () => {
    const result = generateRtcToken('', userId);
    expect(result.token).not.toBeNull();
  });
});
