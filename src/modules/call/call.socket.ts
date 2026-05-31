import { Server, Socket } from 'socket.io';
import crypto from 'crypto';
import { logger } from '@/shared/utils/logger.js';
import { messageService } from '@/modules/chat/message/message.service.js';
import { broadcastMessageNew } from '@/modules/chat/shared/chat.broadcast.js';
import { conversationRepository } from '@/modules/chat/conversation/conversation.repository.js';
import { notificationService } from '@/modules/notification/notification.service.js';
import { userRepository } from '@/modules/user/user.repository.js';
import type {
  CallInitiatePayload,
  CallAcceptPayload,
  CallRejectPayload,
  CallEndPayload,
  CallMissedPayload,
  CallUpgradeRequestPayload,
  CallUpgradeResponsePayload,
  CallGroupLeavePayload,
  CallGroupEndAllPayload,
  CallGroupMissedPayload,
  CallGroupVacantPayload,
  CallGroupRtcJoinedPayload,
  CallGroupRtcLeftPayload,
} from './call.types.js';

const buildChannelName = (userA: string, userB: string): string => {
  const sorted = [userA, userB].sort();
  const hash = crypto.createHash('md5').update(sorted.join('_')).digest('hex').substring(0, 16);
  return `call_${hash}`;
};

const buildGroupChannelName = (conversationId: string): string => {
  const hash = crypto.createHash('md5').update(conversationId).digest('hex').substring(0, 16);
  return `grp_${hash}`;
};

/** Kênh grp_* → host, phiên (sessionId), mốc thời gian để log duration khi client gửi 0. */
export const groupCallMeta = new Map<
  string,
  { hostId: string; conversationId: string; sessionId: string; startedAt: number }
>();

/** userId → channelName — đang trong RTC (1-1 đã accept hoặc nhóm đã join). */
export const userActiveRtcChannel = new Map<string, string>();

/** Bản đồ phiên cuộc gọi đang kích hoạt (direct & group) để phục vụ REST API fallback */
export const activeCalls = new Map<
  string,
  {
    sessionId: string;
    channelName: string;
    callerId: string;
    calleeId?: string; // Chỉ cuộc gọi 1-1
    conversationId: string;
    type: string;
    scope: 'direct' | 'group';
    createdAt: number;
  }
>();

export const bindDirectCallPair = (
  callerId: string,
  calleeId: string,
  channelName: string,
): void => {
  userActiveRtcChannel.set(callerId, channelName);
  userActiveRtcChannel.set(calleeId, channelName);
};

export const bindUserRtcChannel = (uid: string, channelName: string): void => {
  userActiveRtcChannel.set(uid, channelName);
};

export const unbindUserRtc = (uid: string): void => {
  userActiveRtcChannel.delete(uid);
};

export const unbindAllUsersOnChannel = (channelName: string): void => {
  for (const [uid, ch] of [...userActiveRtcChannel.entries()]) {
    if (ch === channelName) userActiveRtcChannel.delete(uid);
  }
};

/** Chỉ `user:*` — tránh trùng socket vừa ở `conv:` vừa ở `user:`. */
export const emitToMemberUsers = (
  io: Server,
  memberUserIds: string[],
  event: string,
  payload: unknown,
): void => {
  for (const uid of memberUserIds) {
    io.to(`user:${uid}`).emit(event, payload);
  }
};

/** Đồng bộ đa thiết bị: mọi socket user:{calleeId} tắt chuông khi một máy accept/reject. */
export const emitCalleeIncomingDismissed = (
  io: Server,
  calleeId: string,
  payload: {
    channelName: string;
    conversationId: string;
    reason: 'accepted' | 'rejected';
    sessionId?: string;
  },
): void => {
  io.to(`user:${calleeId}`).emit('call:incoming-dismissed', payload);
};

export const registerCallHandlers = (io: Server, socket: Socket): void => {
  const userId = socket.data.userId as string;

  socket.on('call:initiate', async (data: CallInitiatePayload) => {
    const scope = data.scope ?? 'direct';

    if (scope === 'group') {
      try {
        const conv = await conversationRepository.getConversationById(data.conversationId);
        if (!conv || conv.type !== 'group') {
          logger.warn(`call:initiate group: invalid conversation ${data.conversationId}`);
          return;
        }
        const members = await conversationRepository.getConversationMembers(data.conversationId);
        if (!members.some((m) => m.userId === userId)) {
          logger.warn(`call:initiate group: ${userId} not a member`);
          return;
        }
        const channelName = buildGroupChannelName(data.conversationId);
        const sessionId = crypto.randomUUID();
        const startedAt = Date.now();
        groupCallMeta.set(channelName, {
          hostId: userId,
          conversationId: data.conversationId,
          sessionId,
          startedAt,
        });

        activeCalls.set(sessionId, {
          sessionId,
          channelName,
          callerId: userId,
          conversationId: data.conversationId,
          type: data.type,
          scope: 'group',
          createdAt: startedAt,
        });

        const incomingPayload = {
          callerId: userId,
          callerName: socket.data.displayName ?? userId,
          callerAvatar: socket.data.avatar ?? null,
          type: data.type,
          channelName,
          conversationId: data.conversationId,
          scope: 'group' as const,
          hostId: userId,
          sessionId,
        };

        const memberIds = members.map((m) => m.userId);
        for (const m of members) {
          if (m.userId === userId) continue;
          io.to(`user:${m.userId}`).emit('call:incoming', incomingPayload);

          // Gửi Push Notification cuộc gọi nhóm đến từng thành viên khác ngầm/chạy nền
          void notificationService
            .dispatch({
              type: 'message',
              userId: m.userId,
              title: conv.name?.trim() || 'Cuộc gọi nhóm',
              body: `${socket.data.displayName ?? userId} đang gọi nhóm...`,
              skipPush: false,
              data: {
                route: 'call',
                id: channelName,
                notificationKind: 'chat_call_group',
                categoryIdentifier: 'hamtech_call_group',
                entityType: 'call',
                entityId: channelName,
                deepLink: `/call?channel=${channelName}&type=${data.type}&conversationId=${data.conversationId}&scope=group&hostId=${userId}&sessionId=${sessionId}`,
                conversationId: data.conversationId,
                callScope: 'group',
                channelName,
                callType: data.type,
                callStatus: 'incoming',
                callerId: userId,
                callerName: socket.data.displayName ?? userId,
                callerAvatar: socket.data.avatar ?? null,
                hostId: userId,
                sessionId,
              },
            })
            .catch((err) => {
              logger.error(`Gửi push notification cuộc gọi nhóm đến ${m.userId} thất bại:`, err);
            });
        }

        emitToMemberUsers(io, memberIds, 'call:group-active', {
          conversationId: data.conversationId,
          channelName,
          type: data.type,
          hostId: userId,
          sessionId,
        });

        socket.emit('call:channel-ready', {
          channelName,
          conversationId: data.conversationId,
          scope: 'group',
          hostId: userId,
          sessionId,
        });
        logger.info(
          `Call group: ${userId} -> conv=${data.conversationId} (${data.type}) channel=${channelName} callerAvatar=${socket.data.avatar}`,
        );
      } catch (e) {
        logger.error('call:initiate group failed:', e);
      }
      return;
    }

    if (!data.calleeId) {
      logger.warn('call:initiate direct: missing calleeId');
      return;
    }

    if (await userRepository.hasBlockBetween(userId, data.calleeId)) {
      socket.emit('call:blocked', {
        conversationId: data.conversationId,
        calleeId: data.calleeId,
        type: data.type,
      });
      logger.info(`Call blocked: ${userId} -> ${data.calleeId} (${data.type})`);
      return;
    }

    if (userActiveRtcChannel.has(data.calleeId)) {
      socket.emit('call:busy', {
        conversationId: data.conversationId,
        calleeId: data.calleeId,
        type: data.type,
      });
      try {
        const message = await messageService.sendMessage(userId, data.conversationId, {
          type: 'call',
          content: JSON.stringify({
            kind: 'missed',
            callType: data.type,
            durationSec: 0,
            reason: 'callee_busy',
          }),
        });
        await broadcastMessageNew(message);
      } catch (e) {
        logger.error('Create call log (busy missed) failed:', e);
      }
      logger.info(`Call busy: ${userId} -> ${data.calleeId} (${data.type})`);
      return;
    }

    const channelName = buildChannelName(userId, data.calleeId);
    const sessionId = crypto.randomUUID();

    activeCalls.set(sessionId, {
      sessionId,
      channelName,
      callerId: userId,
      calleeId: data.calleeId,
      conversationId: data.conversationId,
      type: data.type,
      scope: 'direct',
      createdAt: Date.now(),
    });

    io.to(`user:${data.calleeId}`).emit('call:incoming', {
      callerId: userId,
      callerName: socket.data.displayName ?? userId,
      callerAvatar: socket.data.avatar ?? null,
      type: data.type,
      channelName,
      conversationId: data.conversationId,
      scope: 'direct',
      hostId: userId,
      sessionId,
    });

    // Gửi Push Notification cuộc gọi 1-1 cho người nhận ngầm/chạy nền
    void notificationService
      .dispatch({
        type: 'message',
        userId: data.calleeId,
        title: socket.data.displayName ?? userId,
        body: data.type === 'video' ? 'Cuộc gọi video đến' : 'Cuộc gọi thoại đến',
        skipPush: false,
        data: {
          route: 'call',
          id: channelName,
          notificationKind: 'chat_call_direct',
          categoryIdentifier: 'hamtech_call_direct',
          entityType: 'call',
          entityId: channelName,
          deepLink: `/call?channel=${channelName}&type=${data.type}&conversationId=${data.conversationId}&scope=direct&callerId=${userId}&sessionId=${sessionId}`,
          conversationId: data.conversationId,
          callScope: 'direct',
          channelName,
          callType: data.type,
          callStatus: 'incoming',
          callerId: userId,
          callerName: socket.data.displayName ?? userId,
          callerAvatar: socket.data.avatar ?? null,
          hostId: userId,
          sessionId,
        },
      })
      .catch((err) => {
        logger.error(`Gửi push notification cuộc gọi 1-1 đến ${data.calleeId} thất bại:`, err);
      });

    socket.emit('call:channel-ready', {
      channelName,
      conversationId: data.conversationId,
      scope: 'direct',
      hostId: userId,
      sessionId,
    });
    logger.info(
      `Call: ${userId} -> ${data.calleeId} (${data.type}) channel=${channelName} callerAvatar=${socket.data.avatar}`,
    );
  });

  socket.on('call:accept', (data: CallAcceptPayload) => {
    if (!data.channelName.startsWith('grp_')) {
      bindDirectCallPair(data.callerId, userId, data.channelName);
    }
    io.to(`user:${data.callerId}`).emit('call:accepted', {
      calleeId: userId,
      channelName: data.channelName,
      conversationId: data.conversationId,
      type: data.type,
      sessionId: data.sessionId,
    });
    emitCalleeIncomingDismissed(io, userId, {
      channelName: data.channelName,
      conversationId: data.conversationId,
      reason: 'accepted',
      sessionId: data.sessionId,
    });
    logger.info(`Call accepted: ${userId} on channel=${data.channelName}`);
  });

  socket.on('call:reject', async (data: CallRejectPayload) => {
    if (data.channelName.startsWith('grp_')) {
      io.to(`user:${data.callerId}`).emit('call:group-member-declined', {
        declinedBy: userId,
        channelName: data.channelName,
        conversationId: data.conversationId,
        sessionId: data.sessionId,
      });
      emitCalleeIncomingDismissed(io, userId, {
        channelName: data.channelName,
        conversationId: data.conversationId,
        reason: 'rejected',
        sessionId: data.sessionId,
      });
      logger.info(`Call group member declined: ${userId} channel=${data.channelName}`);
      return;
    }

    io.to(`user:${data.callerId}`).emit('call:rejected', {
      calleeId: userId,
      channelName: data.channelName,
      conversationId: data.conversationId,
      sessionId: data.sessionId,
    });
    emitCalleeIncomingDismissed(io, userId, {
      channelName: data.channelName,
      conversationId: data.conversationId,
      reason: 'rejected',
      sessionId: data.sessionId,
    });
    logger.info(`Call rejected: ${userId} on channel=${data.channelName}`);

    try {
      const message = await messageService.sendMessage(userId, data.conversationId, {
        type: 'call',
        content: JSON.stringify({
          kind: 'rejected',
          callType: data.type,
          durationSec: 0,
        }),
      });
      await broadcastMessageNew(message);
    } catch (e) {
      logger.error('Create call log (rejected) failed:', e);
    }
  });

  socket.on('call:end', async (data: CallEndPayload) => {
    if (data.channelName.startsWith('grp_')) {
      logger.info(
        `call:end ignored for group channel (use call:group-leave / call:group-end-all): ${data.channelName}`,
      );
      return;
    }

    io.to(`user:${data.peerId}`).emit('call:ended', {
      userId,
      channelName: data.channelName,
      conversationId: data.conversationId,
      sessionId: data.sessionId,
    });
    logger.info(`Call ended by ${userId} on channel=${data.channelName}`);

    unbindUserRtc(userId);
    unbindUserRtc(data.peerId);

    let logKind: 'completed' | 'missed' | 'rejected' | 'cancelled' = 'completed';
    if (data.result === 'cancelled') logKind = 'cancelled';
    else if (data.result === 'missed') logKind = 'missed';
    else if (data.result === 'rejected') logKind = 'rejected';

    try {
      const message = await messageService.sendMessage(userId, data.conversationId, {
        type: 'call',
        content: JSON.stringify({
          kind: logKind,
          callType: data.type,
          durationSec: data.durationSec ?? 0,
        }),
      });
      await broadcastMessageNew(message);
    } catch (e) {
      logger.error('Create call log (end) failed:', e);
    }

    if (logKind === 'cancelled' || logKind === 'missed') {
      try {
        await notificationService.dispatch({
          type: 'call_missed',
          userId: data.peerId,
          title: socket.data.displayName ?? userId,
          body: data.type === 'video' ? 'Cuộc gọi video bị nhỡ' : 'Cuộc gọi thoại bị nhỡ',
          skipPush: false,
          data: {
            route: 'chat',
            id: data.conversationId,
            notificationKind: 'chat_call_missed',
            categoryIdentifier: 'hamtech_call_missed',
            entityType: 'call_missed',
            entityId: data.channelName,
            conversationId: data.conversationId,
            callScope: 'direct',
            channelName: data.channelName,
            callType: data.type,
            callStatus: 'missed',
            callerId: userId,
            callerName: socket.data.displayName ?? userId,
            callerAvatar: socket.data.avatar ?? null,
            sessionId: data.sessionId,
          },
        });
      } catch (err) {
        logger.error('Failed to send missed call notification on cancel/timeout:', err);
      }
    }
  });

  socket.on('call:missed', async (data: CallMissedPayload) => {
    if (data.channelName.startsWith('grp_')) {
      logger.info(`call:missed for group — use call:group-missed from host`);
      return;
    }

    io.to(`user:${data.peerId}`).emit('call:ended', {
      userId,
      channelName: data.channelName,
      conversationId: data.conversationId,
      sessionId: data.sessionId,
    });

    try {
      const message = await messageService.sendMessage(userId, data.conversationId, {
        type: 'call',
        content: JSON.stringify({
          kind: 'missed',
          callType: data.type,
          durationSec: 0,
        }),
      });
      await broadcastMessageNew(message);
    } catch (e) {
      logger.error('Create call log (missed) failed:', e);
    }

    try {
      await notificationService.dispatch({
        type: 'call_missed',
        userId: data.peerId,
        title: socket.data.displayName ?? userId,
        body: data.type === 'video' ? 'Cuộc gọi video bị nhỡ' : 'Cuộc gọi thoại bị nhỡ',
        skipPush: false,
        data: {
          route: 'chat',
          id: data.conversationId,
          notificationKind: 'chat_call_missed',
          categoryIdentifier: 'hamtech_call_missed',
          entityType: 'call_missed',
          entityId: data.channelName,
          conversationId: data.conversationId,
          callScope: 'direct',
          channelName: data.channelName,
          callType: data.type,
          callStatus: 'missed',
          callerId: userId,
          callerName: socket.data.displayName ?? userId,
          callerAvatar: socket.data.avatar ?? null,
          sessionId: data.sessionId,
        },
      });
    } catch (err) {
      logger.error('Failed to send missed call notification on timeout:', err);
    }
  });

  socket.on('call:group-missed', async (data: CallGroupMissedPayload) => {
    const meta = groupCallMeta.get(data.channelName);
    if (!meta || meta.hostId !== userId) {
      logger.warn('call:group-missed denied or unknown channel');
      return;
    }
    try {
      const conv = await conversationRepository.getConversationById(data.conversationId);
      if (!conv) return;
      const members = await conversationRepository.getConversationMembers(data.conversationId);
      const ids = members.map((m) => m.userId);
      const sessionId = meta.sessionId;
      const endPayload = {
        userId,
        channelName: data.channelName,
        conversationId: data.conversationId,
        reason: 'timeout' as const,
        scope: 'group' as const,
        sessionId,
      };
      emitToMemberUsers(io, ids, 'call:ended', endPayload);
      emitToMemberUsers(io, ids, 'call:group-inactive', {
        conversationId: data.conversationId,
        sessionId,
      });
      groupCallMeta.delete(data.channelName);
      unbindAllUsersOnChannel(data.channelName);

      const message = await messageService.sendMessage(userId, data.conversationId, {
        type: 'call',
        content: JSON.stringify({
          kind: 'missed',
          callType: data.type,
          durationSec: 0,
          scope: 'group',
          sessionId,
        }),
      });
      await broadcastMessageNew(message);

      for (const m of members) {
        if (m.userId === userId) continue;
        void notificationService
          .dispatch({
            type: 'call_missed',
            userId: m.userId,
            title: conv.name?.trim() || 'Cuộc gọi nhóm',
            body: `Cuộc gọi nhỡ từ ${socket.data.displayName ?? userId}`,
            skipPush: false,
            data: {
              route: 'chat',
              id: data.conversationId,
              notificationKind: 'chat_call_missed',
              categoryIdentifier: 'hamtech_call_missed',
              entityType: 'call_missed',
              entityId: data.channelName,
              conversationId: data.conversationId,
              callScope: 'group',
              channelName: data.channelName,
              callType: data.type,
              callStatus: 'missed',
              callerId: userId,
              callerName: socket.data.displayName ?? userId,
              callerAvatar: socket.data.avatar ?? null,
              conversationName: conv.name?.trim() || 'Cuộc gọi nhóm',
              conversationAvatar: conv.avatar || null,
              sessionId,
            },
          })
          .catch((err) => {
            logger.error(`Gửi notification cuộc gọi nhóm nhỡ đến ${m.userId} thất bại:`, err);
          });
      }
    } catch (e) {
      logger.error('call:group-missed failed:', e);
    }
  });

  socket.on('call:group-rtc-joined', async (data: CallGroupRtcJoinedPayload) => {
    if (!data.channelName.startsWith('grp_')) {
      logger.warn('call:group-rtc-joined: not a group channel');
      return;
    }
    const meta = groupCallMeta.get(data.channelName);
    if (!meta || meta.conversationId !== data.conversationId) {
      logger.warn('call:group-rtc-joined: unknown or inactive session');
      return;
    }
    try {
      const members = await conversationRepository.getConversationMembers(data.conversationId);
      if (!members.some((m) => m.userId === userId)) {
        logger.warn('call:group-rtc-joined: not a member');
        return;
      }
      bindUserRtcChannel(userId, data.channelName);
      logger.info(`call:group-rtc-joined ${userId} ${data.channelName}`);
    } catch (e) {
      logger.error('call:group-rtc-joined failed:', e);
    }
  });

  socket.on('call:group-rtc-left', (data: CallGroupRtcLeftPayload) => {
    if (!data.channelName.startsWith('grp_')) return;
    const ch = userActiveRtcChannel.get(userId);
    if (ch === data.channelName) {
      unbindUserRtc(userId);
      logger.info(`call:group-rtc-left ${userId} ${data.channelName}`);
    }
  });

  socket.on('call:group-leave', async (data: CallGroupLeavePayload) => {
    try {
      unbindUserRtc(userId);
      const members = await conversationRepository.getConversationMembers(data.conversationId);
      const ids = members.map((m) => m.userId);
      emitToMemberUsers(io, ids, 'call:group-participant-left', {
        userId,
        channelName: data.channelName,
        conversationId: data.conversationId,
      });
      logger.info(`call:group-leave ${userId} channel=${data.channelName}`);
    } catch (e) {
      logger.error('call:group-leave failed:', e);
    }
  });

  socket.on('call:group-end-all', async (data: CallGroupEndAllPayload) => {
    const meta = groupCallMeta.get(data.channelName);
    if (!meta || meta.hostId !== userId) {
      logger.warn('call:group-end-all denied');
      return;
    }
    try {
      const members = await conversationRepository.getConversationMembers(data.conversationId);
      const ids = members.map((m) => m.userId);
      const sessionId = meta.sessionId;
      const rawClient = data.durationSec;
      const clientSecs =
        typeof rawClient === 'number' && !Number.isNaN(rawClient)
          ? rawClient
          : Number(rawClient) || 0;
      const serverSecs = Math.max(0, Math.floor((Date.now() - meta.startedAt) / 1000));
      const durationSec = Math.max(serverSecs, clientSecs);

      const endPayload = {
        userId,
        channelName: data.channelName,
        conversationId: data.conversationId,
        reason: 'host-ended' as const,
        scope: 'group' as const,
        sessionId,
      };
      emitToMemberUsers(io, ids, 'call:ended', endPayload);
      emitToMemberUsers(io, ids, 'call:group-inactive', {
        conversationId: data.conversationId,
        sessionId,
      });
      groupCallMeta.delete(data.channelName);
      unbindAllUsersOnChannel(data.channelName);

      const message = await messageService.sendMessage(userId, data.conversationId, {
        type: 'call',
        content: JSON.stringify({
          kind: 'completed',
          callType: data.type,
          durationSec,
          scope: 'group',
          sessionId,
        }),
      });
      await broadcastMessageNew(message);
    } catch (e) {
      logger.error('call:group-end-all failed:', e);
    }
  });

  socket.on('call:group-vacant', async (data: CallGroupVacantPayload) => {
    const meta = groupCallMeta.get(data.channelName);
    if (!meta || meta.conversationId !== data.conversationId) {
      return;
    }
    try {
      const members = await conversationRepository.getConversationMembers(data.conversationId);
      if (!members.some((m) => m.userId === userId)) {
        logger.warn('call:group-vacant: not a member');
        return;
      }
      const ids = members.map((m) => m.userId);
      const sessionId = meta.sessionId;
      emitToMemberUsers(io, ids, 'call:group-inactive', {
        conversationId: data.conversationId,
        sessionId,
      });
      groupCallMeta.delete(data.channelName);
      unbindAllUsersOnChannel(data.channelName);
      logger.info(`call:group-vacant ${data.channelName} conv=${data.conversationId}`);
    } catch (e) {
      logger.error('call:group-vacant failed:', e);
    }
  });

  socket.on('call:upgrade-request', (data: CallUpgradeRequestPayload) => {
    io.to(`user:${data.peerId}`).emit('call:upgrade-request', {
      fromUserId: userId,
      channelName: data.channelName,
    });
    logger.info(`Upgrade request: ${userId} -> ${data.peerId} on channel=${data.channelName}`);
  });

  socket.on('call:upgrade-response', (data: CallUpgradeResponsePayload) => {
    io.to(`user:${data.peerId}`).emit('call:upgrade-response', {
      fromUserId: userId,
      channelName: data.channelName,
      accepted: data.accepted,
    });
    logger.info(
      `Upgrade ${data.accepted ? 'accepted' : 'rejected'}: ${userId} on channel=${data.channelName}`,
    );
  });
};
