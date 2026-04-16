import { Server, Socket } from 'socket.io';
import crypto from 'crypto';
import { logger } from '@/shared/utils/logger.js';
import { messageService } from '@/modules/chat/message/message.service.js';
import { broadcastMessageNew } from '@/modules/chat/shared/chat.broadcast.js';
import type {
  CallInitiatePayload,
  CallAcceptPayload,
  CallRejectPayload,
  CallEndPayload,
  CallMissedPayload,
  CallUpgradeRequestPayload,
  CallUpgradeResponsePayload,
} from './call.types.js';

const buildChannelName = (userA: string, userB: string): string => {
  const sorted = [userA, userB].sort();
  const hash = crypto.createHash('md5').update(sorted.join('_')).digest('hex').substring(0, 16);
  return `call_${hash}`;
};

export const registerCallHandlers = (io: Server, socket: Socket): void => {
  const userId = socket.data.userId as string;

  socket.on('call:initiate', (data: CallInitiatePayload) => {
    const channelName = buildChannelName(userId, data.calleeId);

    io.to(`user:${data.calleeId}`).emit('call:incoming', {
      callerId: userId,
      callerName: socket.data.displayName ?? userId,
      type: data.type,
      channelName,
      conversationId: data.conversationId,
    });

    socket.emit('call:channel-ready', { channelName, conversationId: data.conversationId });
    logger.info(`Call: ${userId} -> ${data.calleeId} (${data.type}) channel=${channelName}`);
  });

  socket.on('call:accept', (data: CallAcceptPayload) => {
    io.to(`user:${data.callerId}`).emit('call:accepted', {
      calleeId: userId,
      channelName: data.channelName,
      conversationId: data.conversationId,
      type: data.type,
    });
    logger.info(`Call accepted: ${userId} on channel=${data.channelName}`);
  });

  socket.on('call:reject', async (data: CallRejectPayload) => {
    io.to(`user:${data.callerId}`).emit('call:rejected', {
      calleeId: userId,
      channelName: data.channelName,
      conversationId: data.conversationId,
    });
    logger.info(`Call rejected: ${userId} on channel=${data.channelName}`);

    // Log: rejected call (no duration)
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
    io.to(`user:${data.peerId}`).emit('call:ended', {
      userId,
      channelName: data.channelName,
      conversationId: data.conversationId,
    });
    logger.info(`Call ended by ${userId} on channel=${data.channelName}`);

    // Log: completed (or custom result) with duration
    try {
      const message = await messageService.sendMessage(userId, data.conversationId, {
        type: 'call',
        content: JSON.stringify({
          kind: data.result ?? 'completed',
          callType: data.type,
          durationSec: data.durationSec ?? 0,
        }),
      });
      await broadcastMessageNew(message);
    } catch (e) {
      logger.error('Create call log (end) failed:', e);
    }
  });

  socket.on('call:missed', async (data: CallMissedPayload) => {
    // Let callee auto-close incoming modal
    io.to(`user:${data.peerId}`).emit('call:ended', {
      userId,
      channelName: data.channelName,
      conversationId: data.conversationId,
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
    logger.info(`Upgrade ${data.accepted ? 'accepted' : 'rejected'}: ${userId} on channel=${data.channelName}`);
  });
};
