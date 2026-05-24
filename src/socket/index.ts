import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { env } from '@/config/env.js';
import { logger } from '@/shared/utils/logger.js';
import { authenticateSocket } from './auth.socket.js';
import { registerHandlers } from './handlers.js';
import { userService } from '@/modules/user/user.service.js';

let io: Server;

const notifyFriendsAboutStatus = async (
  userId: string,
  status: 'online' | 'offline' | 'away',
): Promise<void> => {
  const friends = await userService.getFriends(userId, 1000);
  friends.friends.forEach((friend) => {
    io.to(`user:${friend.userId}`).emit('friend:statusChanged', {
      userId,
      status,
      timestamp: new Date(),
    });
  });
};

export const initializeSocket = (httpServer: HttpServer): void => {
  io = new Server(httpServer, {
    cors: {
      origin: env.CORS_ORIGINS.split(','),
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  io.use(authenticateSocket);

  io.on('connection', (socket) => {
    logger.info(`Socket kết nối: ${socket.id} (user: ${socket.data.userId})`);
    const userId = socket.data.userId as string;

    // Join user-specific room for targeted notifications
    socket.join(`user:${userId}`);

    // Set user status to online and notify friends
    userService
      .updateUserStatus(userId, 'online')
      .then(() => notifyFriendsAboutStatus(userId, 'online'))
      .catch((error) => {
        logger.error('Failed to update user status to online:', error);
      });

    const sessionId = socket.data.sessionId as string | undefined;
    if (sessionId) {
      socket.join(`session:${sessionId}`);
      logger.debug(`Socket ${socket.id} joined session:${sessionId}`);
    }

    registerHandlers(io, socket);

    socket.on('disconnect', async (reason) => {
      logger.info(`Socket ngắt kết nối: ${socket.id} — ${reason}`);

      // Set user status to offline
      try {
        const remainingSockets = await io.in(`user:${userId}`).fetchSockets();
        if (remainingSockets.length > 0) return;

        await userService.updateUserStatus(userId, 'offline');
        await notifyFriendsAboutStatus(userId, 'offline');
      } catch (error) {
        logger.error('Failed to update user status to offline:', error);
      }
    });
  });

  logger.info('Socket.io server đã khởi tạo');
};

export const getIO = (): Server => {
  if (!io) throw new Error('Socket.io chưa được khởi tạo');
  return io;
};
