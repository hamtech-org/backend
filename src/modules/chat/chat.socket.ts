import { Server, Socket } from 'socket.io';
import { logger } from '@/shared/utils/logger.js';

export const registerChatHandlers = (io: Server, socket: Socket): void => {
  const userId = socket.data.userId as string;

  socket.on('conversation:join', (conversationId: string) => {
    socket.join(`conv:${conversationId}`);
    logger.debug(`User ${userId} tham gia room conv:${conversationId}`);
  });

  socket.on('conversation:leave', (conversationId: string) => {
    socket.leave(`conv:${conversationId}`);
  });

  socket.on('message:send', async (_data: unknown) => {
    // TODO: Xử lý gửi tin nhắn qua socket
    // 1. Validate data
    // 2. Lưu vào DB
    // 3. Emit message:new cho room
    void io;
  });

  socket.on('message:typing', (conversationId: string) => {
    socket.to(`conv:${conversationId}`).emit('message:typing_indicator', {
      userId,
      conversationId,
    });
  });

  socket.on('message:read', async (_data: { conversationId: string; messageId: string }) => {
    // TODO: Cập nhật trạng thái đã đọc
  });
};
