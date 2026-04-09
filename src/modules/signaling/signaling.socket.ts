import { Server, Socket } from 'socket.io';
import { logger } from '@/shared/utils/logger.js';
import type { ICallOffer, ICallAnswer, IIceCandidate } from './signaling.types.js';

export const registerSignalingHandlers = (io: Server, socket: Socket): void => {
  const userId = socket.data.userId as string;

  socket.on('call:initiate', (data: { calleeId: string; type: 'audio' | 'video' }) => {
    // TODO: Tạo call session, gửi thông báo cho callee
    io.to(`user:${data.calleeId}`).emit('call:incoming', {
      callerId: userId,
      type: data.type,
    });
    logger.debug(`User ${userId} gọi cho ${data.calleeId} (${data.type})`);
  });

  socket.on('call:accept', (data: { callId: string; callerId: string }) => {
    // TODO: Cập nhật call session status = active
    io.to(`user:${data.callerId}`).emit('call:accepted', {
      callId: data.callId,
      calleeId: userId,
    });
  });

  socket.on('call:reject', (data: { callId: string; callerId: string }) => {
    // TODO: Cập nhật call session status = rejected
    io.to(`user:${data.callerId}`).emit('call:rejected', {
      callId: data.callId,
      calleeId: userId,
    });
  });

  socket.on('call:end', (data: { callId: string; peerId: string }) => {
    // TODO: Cập nhật call session status = ended, tính duration
    io.to(`user:${data.peerId}`).emit('call:ended', {
      callId: data.callId,
      userId,
    });
  });

  socket.on('call:offer', (data: ICallOffer) => {
    io.to(`user:${data.calleeId}`).emit('call:offer', data);
  });

  socket.on('call:answer', (data: ICallAnswer) => {
    // TODO: Gửi SDP answer cho caller
    io.to(`user:${data.calleeId}`).emit('call:answer', data);
  });

  socket.on('call:ice-candidate', (data: IIceCandidate) => {
    // TODO: Forward ICE candidate cho peer
    socket.broadcast.emit('call:ice-candidate', data);
  });

  socket.on('call:toggle-audio', (data: { callId: string; peerId: string; enabled: boolean }) => {
    io.to(`user:${data.peerId}`).emit('call:audio-toggled', {
      userId,
      enabled: data.enabled,
    });
  });

  socket.on('call:toggle-video', (data: { callId: string; peerId: string; enabled: boolean }) => {
    io.to(`user:${data.peerId}`).emit('call:video-toggled', {
      userId,
      enabled: data.enabled,
    });
  });
};
