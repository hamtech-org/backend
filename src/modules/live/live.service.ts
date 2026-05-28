import { randomUUID } from 'crypto';
import { ForbiddenError, NotFoundError } from '@/shared/utils/errors.js';
import { userRepository } from '@/modules/user/user.repository.js';
import { notificationService } from '@/modules/notification/notification.service.js';
import { getIO } from '@/socket/index.js';
import { logger } from '@/shared/utils/logger.js';
import { emitToLiveRoom } from './live.broadcast.js';
import { buildLiveChannelName, liveRepository } from './live.repository.js';
import { getLiveViewerUserIds } from './live.presence.js';
import type {
  CreateLiveSessionInput,
  ILiveSessionMeta,
  LiveSessionListItem,
  LiveSessionPublic,
  PatchLiveSessionInput,
} from './live.types.js';

const toPublicSession = (meta: ILiveSessionMeta): LiveSessionPublic => ({
  sessionId: meta.sessionId,
  channelName: meta.channelName,
  title: meta.title,
  hostUserId: meta.hostUserId,
  status: meta.status,
  startedAt: meta.startedAt,
  category: meta.category ?? 'other',
  coverImageUrl: meta.coverImageUrl,
  coverColor: meta.coverColor,
});

/** Thông báo bạn bè khi host bắt đầu phiên live (inbox + socket + push). */
async function notifyFollowersLiveStarted(
  hostUserId: string,
  session: LiveSessionPublic,
): Promise<void> {
  try {
    const followerIds = await userRepository.getFriendIds(hostUserId, 200);
    if (followerIds.length === 0) return;

    const host = await userRepository.findById(hostUserId);
    const hostName = host?.displayName ?? 'Ai đó';
    const sessionTitle = session.title?.trim() || 'Live';
    const body = `${hostName} đang phát live: ${sessionTitle}`;

    const io = getIO();
    for (const followerId of followerIds) {
      if (followerId === hostUserId) continue;

      io.to(`user:${followerId}`).emit('live:started', {
        sessionId: session.sessionId,
        hostUserId,
        title: sessionTitle,
      });

      void notificationService
        .dispatch({
          type: 'live_started',
          userId: followerId,
          title: 'Đang phát live',
          body,
          data: {
            route: 'live',
            id: session.sessionId,
            entityType: 'live',
            entityId: session.sessionId,
            deepLink: `/live/${session.sessionId}`,
            actorId: hostUserId,
            actorName: hostName,
            actorAvatar: host?.avatar ?? null,
            extra: { hostUserId, sessionTitle },
          },
        })
        .catch((e) => logger.error('live_started notification failed', e));
    }
  } catch (err) {
    logger.error('Failed to notify live_started', err);
  }
}

export const liveAgoraService = {
  assertPublisherToken: async (channelName: string, userId: string): Promise<void> => {
    const meta = await liveRepository.findMetaByChannelName(channelName);
    if (!meta || meta.status !== 'live') {
      throw new ForbiddenError('Phiên live không hợp lệ');
    }
    if (meta.hostUserId !== userId) {
      throw new ForbiddenError('Chỉ host phiên mới được publish');
    }
  },

  assertSubscriberToken: async (channelName: string): Promise<void> => {
    const meta = await liveRepository.findMetaByChannelName(channelName);
    if (!meta || meta.status !== 'live') {
      throw new ForbiddenError('Phiên live không hợp lệ hoặc đã kết thúc');
    }
  },
};

export const liveService = {
  createSession: async (
    userId: string,
    input: CreateLiveSessionInput = {},
  ): Promise<LiveSessionPublic> => {
    const sessionId = randomUUID();
    const channelName = buildLiveChannelName(sessionId);
    const now = new Date().toISOString();

    const meta: ILiveSessionMeta = {
      PK: `SESSION#${sessionId}`,
      SK: 'META',
      sessionId,
      channelName,
      hostUserId: userId,
      title: input.title?.trim() || 'Live',
      category: input.category ?? 'other',
      ...(input.coverImageUrl ? { coverImageUrl: input.coverImageUrl } : {}),
      ...(input.coverColor ? { coverColor: input.coverColor } : {}),
      status: 'live',
      createdAt: now,
      startedAt: now,
      GSI1PK: 'live#active',
      GSI1SK: now,
      GSI2PK: channelName,
      GSI2SK: sessionId,
    };

    await liveRepository.putMeta(meta);
    const session = toPublicSession(meta);
    void notifyFollowersLiveStarted(userId, session);
    return session;
  },

  listActiveSessions: async (): Promise<LiveSessionListItem[]> => {
    const list = await liveRepository.listActive(80);
    const metas = list.filter((m) => m.SK === 'META' && m.status === 'live');
    if (metas.length === 0) return [];

    const hostIds = [...new Set(metas.map((m) => m.hostUserId))];
    const hosts = await userRepository.findByIds(hostIds);
    const hostById = new Map(hosts.map((u) => [u.userId, u]));

    return metas.map((meta) => {
      const host = hostById.get(meta.hostUserId);
      return {
        ...toPublicSession(meta),
        hostDisplayName: host?.displayName ?? 'Người dùng',
        hostAvatar: host?.avatar ?? null,
        viewerCount: getLiveViewerUserIds(meta.sessionId).length,
      };
    });
  },

  getSessionById: async (sessionId: string): Promise<LiveSessionPublic> => {
    const meta = await liveRepository.findMetaById(sessionId);
    if (!meta) throw new NotFoundError('Phiên live');
    return toPublicSession(meta);
  },

  patchSession: async (
    sessionId: string,
    userId: string,
    body: PatchLiveSessionInput,
  ): Promise<LiveSessionPublic> => {
    const meta = await liveRepository.findMetaById(sessionId);
    if (!meta) throw new NotFoundError('Phiên live');
    if (meta.hostUserId !== userId) {
      throw new ForbiddenError('Chỉ host mới cập nhật được phiên');
    }

    const updates: PatchLiveSessionInput = {};
    if (body.title !== undefined) updates.title = body.title.trim();
    if (body.category !== undefined) updates.category = body.category;
    if (body.coverImageUrl !== undefined) updates.coverImageUrl = body.coverImageUrl;
    if (body.coverColor !== undefined) updates.coverColor = body.coverColor;

    const updated = await liveRepository.updateMeta(sessionId, updates);
    emitToLiveRoom(sessionId, 'live:session-updated', {
      title: updated.title,
      category: updated.category,
      coverImageUrl: updated.coverImageUrl,
      coverColor: updated.coverColor,
    });
    return toPublicSession(updated);
  },

  endSession: async (sessionId: string, userId: string): Promise<void> => {
    const meta = await liveRepository.findMetaById(sessionId);
    if (!meta) throw new NotFoundError('Phiên live');
    if (meta.hostUserId !== userId) {
      throw new ForbiddenError('Chỉ host mới kết thúc được phiên');
    }
    const endedAt = new Date().toISOString();
    await liveRepository.markSessionEnded(meta.sessionId, endedAt);
    emitToLiveRoom(meta.sessionId, 'live:session-ended', { sessionId: meta.sessionId, endedAt });
  },
};
