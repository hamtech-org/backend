import { Server, Socket } from 'socket.io';
import { logger } from '@/shared/utils/logger.js';
import { userService } from './user.service.js';

export const registerUserHandlers = (io: Server, socket: Socket): void => {
  const userId = socket.data.userId as string;

  // ─── Friend request notifications ──────────────────────────────

  socket.on('friendRequest:send', async (receiverId: string) => {
    try {
      await userService.sendFriendRequest(userId, receiverId);
      
      // Notify the receiver
      io.to(`user:${receiverId}`).emit('friendRequest:new', {
        senderId: userId,
        timestamp: new Date(),
      });

      // Confirm to sender
      socket.emit('friendRequest:sent', { receiverId });
      logger.info(`Friend request sent from ${userId} to ${receiverId}`);
    } catch (error) {
      logger.error('Socket friendRequest:send error:', error);
      socket.emit('friendRequest:error', { error: 'Gửi lời mời thất bại' });
    }
  });

  socket.on('friendRequest:accept', async (senderId: string) => {
    try {
      await userService.acceptFriendRequest(userId, senderId);

      // Notify both users
      io.to(`user:${senderId}`).emit('friendRequest:accepted', {
        userId,
        timestamp: new Date(),
      });

      socket.emit('friendRequest:accepted', {
        userId: senderId,
        timestamp: new Date(),
      });

      // Notify about new friendship
      io.to(`user:${senderId}`).emit('friend:added', {
        friendId: userId,
        timestamp: new Date(),
      });

      socket.emit('friend:added', {
        friendId: senderId,
        timestamp: new Date(),
      });

      logger.info(`Friend request accepted from ${userId} to ${senderId}`);
    } catch (error) {
      logger.error('Socket friendRequest:accept error:', error);
      socket.emit('friendRequest:error', { error: 'Chấp nhận lời mời thất bại' });
    }
  });

  socket.on('friendRequest:reject', async (senderId: string) => {
    try {
      await userService.rejectFriendRequest(userId, senderId);

      // Notify the sender
      io.to(`user:${senderId}`).emit('friendRequest:rejected', {
        userId,
        timestamp: new Date(),
      });

      socket.emit('friendRequest:rejected', {
        userId: senderId,
        timestamp: new Date(),
      });

      logger.info(`Friend request rejected from ${userId} to ${senderId}`);
    } catch (error) {
      logger.error('Socket friendRequest:reject error:', error);
      socket.emit('friendRequest:error', { error: 'Từ chối lời mời thất bại' });
    }
  });

  // ─── Friend removal ───────────────────────────────────────────

  socket.on('friend:remove', async (friendId: string) => {
    try {
      await userService.removeFriend(userId, friendId);

      // Notify the other user
      io.to(`user:${friendId}`).emit('friend:removed', {
        userId,
        timestamp: new Date(),
      });

      socket.emit('friend:removed', {
        friendId,
        timestamp: new Date(),
      });

      logger.info(`Friend removed: ${userId} removed ${friendId}`);
    } catch (error) {
      logger.error('Socket friend:remove error:', error);
      socket.emit('friend:error', { error: 'Xóa bạn thất bại' });
    }
  });

  // ─── Friend status updates ────────────────────────────────────

  socket.on('friend:statusChanged', async (status: 'online' | 'offline' | 'away') => {
    try {
      // Broadcast status to all rooms the user is in
      socket.broadcast.emit('friend:statusChanged', {
        userId,
        status,
        timestamp: new Date(),
      });

      logger.debug(`User ${userId} status changed to ${status}`);
    } catch (error) {
      logger.error('Socket friend:statusChanged error:', error);
    }
  });
};
