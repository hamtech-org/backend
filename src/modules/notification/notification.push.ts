import { env } from '@/config/env.js';
import { logger } from '@/shared/utils/logger.js';
import { deviceTokenRepository } from './device-token.repository.js';
import type { INotificationRouteData } from './notification.types.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | 'amthanhnhan' | null;
  image?: string;
  channelId?: string;
  categoryId?: string;
}

function pushChannelId(data: INotificationRouteData & Record<string, unknown>): string {
  const route = String(data?.route ?? '');
  if (route === 'call') return 'calls';
  if (route === 'chat') return 'messages';
  return 'social';
}

function enrichPushData(
  data: INotificationRouteData & Record<string, unknown>,
): INotificationRouteData & Record<string, unknown> {
  const enriched: INotificationRouteData & Record<string, unknown> = {
    ...data,
    notificationKind:
      data.notificationKind ??
      (data.route === 'chat'
        ? 'chat_message'
        : data.route === 'call'
          ? 'chat_call_direct'
          : 'inbox_social'),
  };
  if (data.route === 'chat') {
    const conversationId = String(data.id ?? data.entityId ?? '').trim();
    if (conversationId) {
      enriched.notificationId = enriched.notificationId ?? `chat-${conversationId}`;
      enriched.categoryIdentifier = enriched.categoryIdentifier ?? 'hamtech_message';
    }
  }
  if (data.route === 'call') {
    const callScope = String(data.callScope ?? '').trim();
    const isGroup = callScope === 'group';
    enriched.notificationKind = isGroup ? 'chat_call_group' : 'chat_call_direct';
    enriched.categoryIdentifier =
      enriched.categoryIdentifier ?? (isGroup ? 'hamtech_call_group' : 'hamtech_call_direct');
    const channelName = String(data.channelName ?? data.entityId ?? data.id ?? '').trim();
    if (channelName) {
      enriched.notificationId = enriched.notificationId ?? `call-${channelName}`;
    }
  }
  return enriched;
}

function normalizeBackendAvatarUrl(url: unknown): string | undefined {
  logger.info(`[PushAvatar] normalizeBackendAvatarUrl input: ${url}`);
  if (typeof url !== 'string' || !url.trim()) return undefined;
  let target = url.trim();

  if (target.startsWith('/')) {
    target = `${env.API_PUBLIC_ORIGIN}${target}`;
  }

  const isPublicOrigin =
    !env.API_PUBLIC_ORIGIN.includes('localhost') &&
    !env.API_PUBLIC_ORIGIN.includes('127.0.0.1') &&
    !env.API_PUBLIC_ORIGIN.includes('0.0.0.0');

  if (
    isPublicOrigin &&
    (target.includes('localhost') ||
      target.includes('127.0.0.1') ||
      target.includes('0.0.0.0') ||
      target.includes('host.docker.internal'))
  ) {
    target = target.replace(
      /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal)(:\d+)?/g,
      env.API_PUBLIC_ORIGIN,
    );
  }

  logger.info(`[PushAvatar] normalizeBackendAvatarUrl output: ${target}`);
  return target;
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

    if (expoTokens.length === 0) {
      logger.info(`[PushAvatar] No expo push tokens found for user ${userId}`);
      return;
    }

    const isGroup =
      data?.chatScope === 'group' ||
      data?.conversationType === 'group' ||
      data?.callScope === 'group';

    let rawAvatar = isGroup
      ? data?.groupAvatar || data?.conversationAvatar || data?.imageUrl
      : data?.callerAvatar ||
        data?.actorAvatar ||
        data?.senderAvatar ||
        data?.avatarUrl ||
        data?.imageUrl;

    if (!rawAvatar && isGroup) {
      const conversationId =
        data?.conversationId || (data?.route === 'chat' ? data?.id : undefined);
      if (conversationId) {
        rawAvatar = `${env.API_PUBLIC_ORIGIN}/api/v1/chat/conversations/${conversationId}/avatar`;
      }
    }

    const normalizedAvatar = normalizeBackendAvatarUrl(rawAvatar);
    logger.info(`[PushAvatar] rawAvatar: ${rawAvatar}, normalizedAvatar: ${normalizedAvatar}`);

    const enrichedData = enrichPushData(data);
    if (normalizedAvatar) {
      enrichedData.callerAvatar = enrichedData.callerAvatar || normalizedAvatar;
      enrichedData.actorAvatar = enrichedData.actorAvatar || normalizedAvatar;
      enrichedData.senderAvatar = enrichedData.senderAvatar || normalizedAvatar;
      enrichedData.avatarUrl = enrichedData.avatarUrl || normalizedAvatar;
      enrichedData.conversationAvatar = enrichedData.conversationAvatar || normalizedAvatar;
      enrichedData.groupAvatar = enrichedData.groupAvatar || normalizedAvatar;
      enrichedData.imageUrl = enrichedData.imageUrl || normalizedAvatar;
    }

    const channelId = pushChannelId(enrichedData);
    const categoryId =
      typeof enrichedData.categoryIdentifier === 'string'
        ? enrichedData.categoryIdentifier
        : undefined;
    const pushSound = channelId === 'calls' ? 'amthanhnhan' : 'default';
    const messages: ExpoPushMessage[] = expoTokens.map((to) => ({
      to,
      title,
      body,
      data: enrichedData,
      sound: pushSound,
      channelId,
      ...(categoryId ? { categoryId } : {}),
      ...(normalizedAvatar ? { image: normalizedAvatar } : {}),
    }));

    const chunks: ExpoPushMessage[][] = [];
    for (let i = 0; i < messages.length; i += 100) {
      chunks.push(messages.slice(i, i + 100));
    }

    for (const chunk of chunks) {
      logger.info(`[PushAvatar] Sending Expo Push chunk: ${JSON.stringify(chunk)}`);
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(chunk),
      });
      const responseBody = await res.text();
      logger.info(`[PushAvatar] Expo response status: ${res.status}, body: ${responseBody}`);
      if (!res.ok) {
        logger.warn(`Expo push HTTP ${res.status} for user ${userId}`);
      }
    }
  } catch (error) {
    logger.error(`Expo push failed for user ${userId}:`, error);
  }
}
