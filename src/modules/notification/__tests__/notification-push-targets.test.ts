import { selectPushTargetsForNotification } from '../notification.push.js';
import { buildFcmDataOnlyMessage, toFcmStringData } from '../fcm.push.js';
import type { IDevicePushToken } from '../notification.types.js';

function token(value: string, provider: 'expo' | 'fcm', deviceId: string | null): IDevicePushToken {
  return {
    userId: 'user-1',
    token: value,
    platform: 'android',
    provider,
    deviceId,
    createdAt: '2026-05-30T00:00:00.000Z',
    updatedAt: '2026-05-30T00:00:00.000Z',
  };
}

describe('notification push call targets', () => {
  it('uses FCM for incoming Android call and suppresses duplicate Expo token on same device', () => {
    const result = selectPushTargetsForNotification(
      [
        token('ExpoPushToken[device-a]', 'expo', 'device-a'),
        token('fcm-device-a', 'fcm', 'device-a'),
        token('ExpoPushToken[device-b]', 'expo', 'device-b'),
      ],
      {
        route: 'call',
        id: 'chan-1',
        callStatus: 'incoming',
      },
      true,
    );

    expect(result.fcmTokens).toEqual(['fcm-device-a']);
    expect(result.expoTokens).toEqual(['ExpoPushToken[device-b]']);
  });

  it('keeps Expo fallback when FCM is not configured', () => {
    const result = selectPushTargetsForNotification(
      [
        token('ExpoPushToken[device-a]', 'expo', 'device-a'),
        token('fcm-device-a', 'fcm', 'device-a'),
      ],
      {
        route: 'call',
        id: 'chan-1',
        callStatus: 'incoming',
      },
      false,
    );

    expect(result.fcmTokens).toEqual([]);
    expect(result.expoTokens).toEqual(['ExpoPushToken[device-a]']);
  });

  it('serializes FCM data-only payload values as strings', () => {
    expect(
      toFcmStringData({
        route: 'call',
        callStatus: 'incoming',
        count: 1,
        nested: { ok: true },
        empty: null,
      }),
    ).toEqual({
      route: 'call',
      callStatus: 'incoming',
      count: '1',
      nested: '{"ok":true}',
    });
  });

  it('builds high priority FCM data-only messages without notification payload', () => {
    expect(
      buildFcmDataOnlyMessage('fcm-token', {
        route: 'call',
        callStatus: 'incoming',
      }),
    ).toEqual({
      message: {
        token: 'fcm-token',
        data: {
          route: 'call',
          callStatus: 'incoming',
        },
        android: {
          priority: 'HIGH',
          ttl: '30s',
        },
      },
    });
  });
});
