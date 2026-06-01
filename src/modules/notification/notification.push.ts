import { env } from '@/config/env.js';
import { logger } from '@/shared/utils/logger.js';
import { deviceTokenRepository } from './device-token.repository.js';
import { isFcmPushConfigured, sendFcmDataOnlyToTokens } from './fcm.push.js';
import type { IDevicePushToken, INotificationRouteData } from './notification.types.js';

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
  const kind = String(data?.notificationKind ?? '');
  const entityType = String(data?.entityType ?? '');
  if (kind === 'chat_call_missed' || entityType === 'call_missed') return 'messages';
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
      (data.entityType === 'call_missed' || data.callStatus === 'missed'
        ? 'chat_call_missed'
        : data.route === 'chat'
          ? 'chat_message'
          : data.route === 'call'
            ? 'chat_call_direct'
            : 'inbox_social'),
  };
  if (data.entityType === 'call_missed' || data.callStatus === 'missed') {
    const channelName = String(data.channelName ?? data.entityId ?? data.id ?? '').trim();
    enriched.notificationKind = 'chat_call_missed';
    enriched.categoryIdentifier = enriched.categoryIdentifier ?? 'hamtech_call_missed';
    if (channelName) {
      enriched.notificationId = enriched.notificationId ?? `call-${channelName}`;
    }
  }
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
    enriched.callScope = isGroup ? 'group' : 'direct';
    enriched.callStatus = enriched.callStatus ?? 'incoming';
    enriched.callType = enriched.callType ?? 'audio';
    enriched.callerName = enriched.callerName ?? enriched.actorName ?? enriched.senderName;
    const channelName = String(data.channelName ?? data.entityId ?? data.id ?? '').trim();
    if (channelName) {
      enriched.channelName = enriched.channelName ?? channelName;
      enriched.notificationId = enriched.notificationId ?? `call-${channelName}`;
    }
  }
  return enriched;
}

function isCallLifecyclePush(data: INotificationRouteData & Record<string, unknown>): boolean {
  return data.route === 'call' || data.entityType === 'call_missed' || data.callStatus === 'missed';
}

export function selectPushTargetsForNotification(
  tokens: IDevicePushToken[],
  data: INotificationRouteData & Record<string, unknown>,
  canSendFcm: boolean,
): { expoTokens: string[]; fcmTokens: string[] } {
  const isCall = isCallLifecyclePush(data);
  const fcmTokens =
    isCall && canSendFcm
      ? tokens.filter((t) => t.platform === 'android' && t.provider === 'fcm').map((t) => t.token)
      : [];
  const fcmDeviceIds = new Set(
    isCall && canSendFcm
      ? tokens
          .filter((t) => t.platform === 'android' && t.provider === 'fcm' && t.deviceId)
          .map((t) => t.deviceId as string)
      : [],
  );
  const expoTokens = tokens
    .filter((t) => {
      if (t.provider === 'fcm') return false;
      if (!t.token.startsWith('ExponentPushToken') && !t.token.startsWith('ExpoPushToken')) {
        return false;
      }
      return !(isCall && canSendFcm && t.deviceId && fcmDeviceIds.has(t.deviceId));
    })
    .map((t) => t.token);
  return { expoTokens, fcmTokens };
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
    const enrichedData = enrichPushData(data);
    const isCallPush = isCallLifecyclePush(enrichedData);
    const canSendFcm = isCallPush && isFcmPushConfigured();
    const { expoTokens, fcmTokens } = selectPushTargetsForNotification(
      tokens,
      enrichedData,
      canSendFcm,
    );

    if (expoTokens.length === 0 && fcmTokens.length === 0) {
      logger.info(`[PushAvatar] No push tokens found for user ${userId}`);
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
    const isCall =
      enrichedData.route === 'call' || enrichedData.notificationKind === 'chat_call_missed';
    if (isCall) {
      enrichedData.pushTitle = title;
      enrichedData.pushBody = body;
    }

    if (fcmTokens.length > 0) {
      logger.info(`[FCM] Sending incoming call data push to ${fcmTokens.length} token(s)`);
      await sendFcmDataOnlyToTokens(fcmTokens, enrichedData, userId);
    }

    if (expoTokens.length === 0) return;

    const messages: ExpoPushMessage[] = expoTokens.map((to) => {
      const msg: ExpoPushMessage = {
        to,
        data: enrichedData,
        sound: pushSound,
        channelId,
        title,
        body,
        ...(categoryId ? { categoryId } : {}),
        ...(normalizedAvatar ? { image: normalizedAvatar } : {}),
      };
      return msg;
    });

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
