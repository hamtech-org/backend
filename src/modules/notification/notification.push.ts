import { logger } from '@/shared/utils/logger.js';
import { deviceTokenRepository } from './device-token.repository.js';
import type { INotificationRouteData } from './notification.types.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
}

export async function sendExpoPushToUser(
  userId: string,
  title: string,
  body: string,
  data: INotificationRouteData & Record<string, unknown>,
): Promise<void> {
  try {
    const tokens = await deviceTokenRepository.listByUserId(userId);
    const expoTokens = tokens
      .map((t) => t.token)
      .filter((t) => t.startsWith('ExponentPushToken') || t.startsWith('ExpoPushToken'));

    if (expoTokens.length === 0) return;

    const messages: ExpoPushMessage[] = expoTokens.map((to) => ({
      to,
      title,
      body,
      data,
      sound: 'default',
    }));

    const chunks: ExpoPushMessage[][] = [];
    for (let i = 0; i < messages.length; i += 100) {
      chunks.push(messages.slice(i, i + 100));
    }

    for (const chunk of chunks) {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(chunk),
      });
      if (!res.ok) {
        logger.warn(`Expo push HTTP ${res.status} for user ${userId}`);
      }
    }
  } catch (error) {
    logger.error(`Expo push failed for user ${userId}:`, error);
  }
}
