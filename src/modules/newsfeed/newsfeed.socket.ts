import { Server, Socket } from 'socket.io';
import { logger } from '@/shared/utils/logger.js';

/**
 * Đăng ký Socket.io handlers cho Newsfeed module.
 * Client join/leave room để nhận reaction updates real-time.
 */
export const registerNewsfeedHandlers = (_io: Server, socket: Socket): void => {
  // Client đăng ký theo dõi reactions của một bài post
  socket.on('newsfeed:post_join', ({ postId }: { postId: string }) => {
    if (!postId) return;
    void socket.join(`post:${postId}`);
    logger.debug(`Socket ${socket.id} joined post:${postId}`);
  });

  // Client hủy đăng ký theo dõi bài post
  socket.on('newsfeed:post_leave', ({ postId }: { postId: string }) => {
    if (!postId) return;
    void socket.leave(`post:${postId}`);
    logger.debug(`Socket ${socket.id} left post:${postId}`);
  });

  // Client đăng ký theo dõi reactions của một reel
  socket.on('newsfeed:reel_join', ({ reelId }: { reelId: string }) => {
    if (!reelId) return;
    void socket.join(`reel:${reelId}`);
    logger.debug(`Socket ${socket.id} joined reel:${reelId}`);
  });

  // Client hủy đăng ký theo dõi reel
  socket.on('newsfeed:reel_leave', ({ reelId }: { reelId: string }) => {
    if (!reelId) return;
    void socket.leave(`reel:${reelId}`);
    logger.debug(`Socket ${socket.id} left reel:${reelId}`);
  });

  // Client đăng ký nhận reel_new từ followers
  socket.on('newsfeed:user_subscribe', ({ userId }: { userId: string }) => {
    if (!userId) return;
    void socket.join(`user:${userId}`);
    logger.debug(`Socket ${socket.id} subscribed to user:${userId}`);
  });

  socket.on('newsfeed:user_unsubscribe', ({ userId }: { userId: string }) => {
    if (!userId) return;
    void socket.leave(`user:${userId}`);
    logger.debug(`Socket ${socket.id} unsubscribed from user:${userId}`);
  });
};
