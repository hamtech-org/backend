import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { env } from '@/config/env.js';
import { logger } from '@/shared/utils/logger.js';
import { authenticateSocket } from './auth.socket.js';
import { registerHandlers } from './handlers.js';
import { userService } from '@/modules/user/user.service.js';

let io: Server;

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
    
    // Set user status to online
    userService.updateUserStatus(userId, 'online').catch((error) => {
      logger.error('Failed to update user status to online:', error);
    });

    // Join user-specific room for targeted notifications
    socket.join(`user:${userId}`);
    
    registerHandlers(io, socket);

    socket.on('disconnect', async (reason) => {
      logger.info(`Socket ngắt kết nối: ${socket.id} — ${reason}`);
      
      // Set user status to offline
      try {
        await userService.updateUserStatus(userId, 'offline');
        
        // Notify friends about status change
        try {
          const friends = await userService.getFriends(userId, 1000);
          friends.friends.forEach((friend) => {
            io.to(`user:${friend.userId}`).emit('friend:statusChanged', {
              userId,
              status: 'offline',
              timestamp: new Date(),
            });
          });
        } catch (error) {
          logger.error('Failed to notify friends about disconnect:', error);
        }
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
