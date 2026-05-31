import { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { messageService } from './message.service.js';
import { conversationRepository } from '../conversation/conversation.repository.js';
import {
  broadcastMessageNew,
  emitEventsToConversationAndMembers,
} from '../shared/chat.broadcast.js';
import { logger } from '@/shared/utils/logger.js';
import { userRepository } from '@/modules/user/user.repository.js';

// Schema validate data gửi qua socket
const sendMessageSocketSchema = z
  .object({
    conversationId: z.string().uuid(),
    type: z.enum([
      'text',
      'image',
      'video',
      'file',
      'sticker',
      'emoji',
      'location',
      'poll',
      'schedule',
      'call',
      'voice',
    ]),
    content: z.string().max(10000),
    mediaUrl: z.string().url().optional(),
    mediaId: z.string().uuid().optional(),
    replyTo: z.string().uuid().optional(),
    duration: z.number().nonnegative().optional(),
    mentions: z.array(z.string()).max(500).optional().default([]),
  })
  .refine(
    (data) => {
      const m = ['image', 'video', 'file', 'audio', 'voice'] as const;
      if (!m.includes(data.type as (typeof m)[number])) return true;
      return !!(data.mediaUrl ?? data.mediaId);
    },
    { message: 'Tin có media cần mediaUrl hoặc mediaId' },
  );

const readMessageSocketSchema = z.object({
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
});

const deliveredAckSocketSchema = z.object({
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
});

export const registerChatHandlers = (io: Server, socket: Socket): void => {
  const userId = socket.data.userId as string;

  // ─── Room management ───────────────────────────────────────────────────

  socket.on('conversation:join', async (conversationId: string) => {
    const cid = String(conversationId ?? '').trim();
    if (!cid) return;
    const member = await conversationRepository.getMember(cid, userId);
    if (!member) {
      socket.emit('conversation:forbidden', { conversationId: cid });
      return;
    }
    socket.join(`conv:${cid}`);
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
        socket.emit('message:error', {
          error: 'Dữ liệu không hợp lệ',
          details: parsed.error.flatten(),
        });
        return;
      }

      const { conversationId, ...messageData } = parsed.data;

      const message = await messageService.sendMessage(userId, conversationId, messageData);

      await broadcastMessageNew(message);
      io.to(`user:${userId}`).emit('message:status', {
        messageId: message.messageId,
        conversationId,
        status: 'sent',
      });
    } catch (error) {
      logger.error('Socket message:send lỗi:', error);
      socket.emit('message:error', { error: 'Gửi tin nhắn thất bại' });
    }
  });

  // ─── Typing indicator ─────────────────────────────────────────────────

  socket.on('message:delivered_ack', async (data: unknown) => {
    try {
      const parsed = deliveredAckSocketSchema.safeParse(data);
      if (!parsed.success) return;
      const { conversationId, messageId } = parsed.data;
      const member = await conversationRepository.getMember(conversationId, userId);
      if (!member) return;
      const result = await messageService.markOutboundDelivered(conversationId, userId, messageId);
      if (!result) return;
      io.to(`user:${result.senderId}`).emit('message:status', {
        conversationId,
        messageId,
        status: 'delivered',
      });
    } catch (error) {
      logger.error('Socket message:delivered_ack lỗi:', error);
    }
  });

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

      await messageService.markAsRead(conversationId, userId, messageId);

      // Phát cho chính người đọc (để đồng bộ đa thiết bị của họ)
      io.to(`user:${userId}`).emit('conversation:read', {
        conversationId,
        messageId,
      });

      const members = await conversationRepository.getConversationMembers(conversationId);
      const membersExceptSelf = members.filter((m) => m.userId !== userId);
      const conv = await conversationRepository.getConversationById(conversationId);

      if (conv?.type === 'direct') {
        membersExceptSelf.forEach((member) => {
          io.to(`user:${member.userId}`).emit('message:status', {
            conversationId,
            messageId,
            status: 'read',
          });
        });
      }

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

  socket.on(
    'message:recall',
    async (data: { messageId: string; conversationId: string; createdAt: string }) => {
      try {
        await messageService.recallMessage(
          data.messageId,
          userId,
          data.conversationId,
          data.createdAt,
        );
        const recallPayload = { messageId: data.messageId, conversationId: data.conversationId };
        await emitEventsToConversationAndMembers(data.conversationId, [
          { event: 'message:recall', payload: recallPayload },
          { event: 'message:recalled', payload: recallPayload },
          {
            event: 'message:pin_updated',
            payload: {
              messageId: data.messageId,
              conversationId: data.conversationId,
              isPinned: false,
            },
          },
        ]);
      } catch (error) {
        logger.error('Socket message:recall lỗi:', error);
        socket.emit('message:error', { error: 'Thu hồi tin nhắn thất bại' });
      }
    },
  );
};
