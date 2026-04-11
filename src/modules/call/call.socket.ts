import { Server, Socket } from 'socket.io';
import { logger } from '@/shared/utils/logger.js';
import type {
  CallInitiatePayload,
  CallAcceptPayload,
  CallRejectPayload,
  CallEndPayload,
} from './call.types.js';

/**
 * Tạo channel name duy nhất cho cuộc gọi 1-1.
 * Sắp xếp userId để đảm bảo cùng channel cho cả 2 hướng gọi.
 */
const buildChannelName = (userA: string, userB: string): string => {
  const sorted = [userA, userB].sort();
  return `call_${sorted[0]}_${sorted[1]}`;
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
    });

    socket.emit('call:channel-ready', { channelName });

    logger.info(`Call: ${userId} -> ${data.calleeId} (${data.type}) channel=${channelName}`);
  });

  socket.on('call:accept', (data: CallAcceptPayload) => {
    io.to(`user:${data.callerId}`).emit('call:accepted', {
      calleeId: userId,
      channelName: data.channelName,
    });

    logger.info(`Call accepted: ${userId} on channel=${data.channelName}`);
  });

  socket.on('call:reject', (data: CallRejectPayload) => {
    io.to(`user:${data.callerId}`).emit('call:rejected', {
      calleeId: userId,
      channelName: data.channelName,
    });

    logger.info(`Call rejected: ${userId} on channel=${data.channelName}`);
  });

  socket.on('call:end', (data: CallEndPayload) => {
    io.to(`user:${data.peerId}`).emit('call:ended', {
      userId,
      channelName: data.channelName,
    });

    logger.info(`Call ended by ${userId} on channel=${data.channelName}`);
  });
};
