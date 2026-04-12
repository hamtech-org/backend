import { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { chatService } from './chat.service.js';
import { chatRepository } from './chat.repository.js';
import { broadcastMessageNew } from './chat.broadcast.js';
import { logger } from '@/shared/utils/logger.js';
import { userRepository } from '@/modules/user/user.repository.js';

// Schema validate data gửi qua socket
const sendMessageSocketSchema = z.object({
  conversationId: z.string().uuid(),
  type: z.enum(['text', 'image', 'video', 'file', 'sticker', 'emoji', 'location', 'poll', 'schedule']),
  content: z.string().max(10000),
  mediaUrl: z.string().url().optional(),
  replyTo: z.string().uuid().optional(),
});

const readMessageSocketSchema = z.object({
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
});

export const registerChatHandlers = (io: Server, socket: Socket): void => {
  const userId = socket.data.userId as string;

  // ─── Room management ───────────────────────────────────────────────────

  socket.on('conversation:join', (conversationId: string) => {
    socket.join(`conv:${conversationId}`);
    logger.debug(`User ${userId} tham gia room conv:${conversationId}`);
  });

  socket.on('conversation:leave', (conversationId: string) => {
    socket.leave(`conv:${conversationId}`);
    logger.debug(`User ${userId} rời room conv:${conversationId}`);
  });

  // ─── Gửi tin nhắn qua socket ──────────────────────────────────────────

  socket.on('message:send', async (data: unknown) => {
    try {
      const parsed = sendMessageSocketSchema.safeParse(data);
      if (!parsed.success) {
        socket.emit('message:error', { error: 'Dữ liệu không hợp lệ', details: parsed.error.flatten() });
        return;
      }

      const { conversationId, ...messageData } = parsed.data;

      const message = await chatService.sendMessage(userId, conversationId, messageData);

      await broadcastMessageNew(message);

      // Gửi xác nhận delivered cho người gửi
      socket.emit('message:delivered', { messageId: message.messageId, conversationId });
    } catch (error) {
      logger.error('Socket message:send lỗi:', error);
      socket.emit('message:error', { error: 'Gửi tin nhắn thất bại' });
    }
  });

  // ─── Typing indicator ─────────────────────────────────────────────────

  socket.on('message:typing', async (conversationId: string) => {
    let displayName: string | null = null;
    try {
      const user = await userRepository.findById(userId);
      displayName = user?.displayName ?? null;
    } catch (error) {
      logger.debug('Socket message:typing lookup user lỗi:', error);
    }
    socket.to(`conv:${conversationId}`).emit('message:typing_indicator', {
      userId,
      conversationId,
      displayName,
    });
  });

  // ─── Đánh dấu đã đọc ─────────────────────────────────────────────────

  socket.on('message:read', async (data: unknown) => {
    try {
      const parsed = readMessageSocketSchema.safeParse(data);
      if (!parsed.success) return;

      const { conversationId, messageId } = parsed.data;

      await chatService.markAsRead(conversationId, userId, messageId);

      // Cập nhật trạng thái read cho người gửi gốc
      const members = await chatRepository.getConversationMembers(conversationId);
      const membersExceptSelf = members.filter((m) => m.userId !== userId);

      // Thông báo cho các thành viên khác biết tin nhắn đã được đọc
      membersExceptSelf.forEach((member) => {
        io.to(`user:${member.userId}`).emit('message:read_ack', {
          conversationId,
          messageId,
          readBy: userId,
        });
      });
    } catch (error) {
      logger.error('Socket message:read lỗi:', error);
    }
  });

  // ─── Thu hồi tin nhắn qua socket ─────────────────────────────────────

  socket.on('message:recall', async (data: { messageId: string; conversationId: string; createdAt: string }) => {
    try {
      await chatService.recallMessage(data.messageId, userId, data.conversationId, data.createdAt);
      // Phát sự kiện thu hồi đến room
      io.to(`conv:${data.conversationId}`).emit('message:recall', {
        messageId: data.messageId,
        conversationId: data.conversationId,
      });
    } catch (error) {
      logger.error('Socket message:recall lỗi:', error);
      socket.emit('message:error', { error: 'Thu hồi tin nhắn thất bại' });
    }
  });
};
