import { Request, Response, NextFunction } from 'express';
import { messageService } from './message.service.js';
import { groupService } from '../group/group.service.js';
import { sendSuccess, sendCreated } from '@/shared/utils/response.js';
import { getIO } from '@/socket/index.js';
import { broadcastMessageNew, emitEventsToConversationAndMembers, emitToConversationAndMembers } from '../shared/chat.broadcast.js';

export const messageController = {
  getMessages: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const messages = await messageService.getMessages(
        req.params.conversationId,
        req.user!.userId,
        limit,
      );
      sendSuccess(res, messages);
    } catch (error) {
      console.error('[getMessages]', error);
      next(error);
    }
  },

  browseMessages: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const senderId = typeof req.query.senderId === 'string' ? req.query.senderId.trim() : '';
      const from = typeof req.query.from === 'string' ? req.query.from.trim() : '';
      const to = typeof req.query.to === 'string' ? req.query.to.trim() : '';
      const limitRaw = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;

      const messages = await messageService.browseMessages(req.params.conversationId, req.user!.userId, {
        senderId: senderId || undefined,
        from: from || undefined,
        to: to || undefined,
        limit,
      });
      sendSuccess(res, messages);
    } catch (error) {
      console.error('[browseMessages]', error);
      next(error);
    }
  },

  getMessageGallery: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const cat = String(req.query.category ?? '').trim() as 'media' | 'file' | 'link';
      if (cat !== 'media' && cat !== 'file' && cat !== 'link') {
        res.status(400).json({ success: false, error: { message: 'category phải là media | file | link' } });
        return;
      }
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const items = await messageService.getMessageGallery(
        req.params.conversationId,
        req.user!.userId,
        cat,
        limit,
      );
      sendSuccess(res, items);
    } catch (error) {
      console.error('[getMessageGallery]', error);
      next(error);
    }
  },

  sendMessage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const message = await messageService.sendMessage(
        req.user!.userId,
        req.params.conversationId,
        req.body,
      );
      try {
        await broadcastMessageNew(message);
        try {
          const io = getIO();
          io.to(`user:${req.user!.userId}`).emit('message:status', {
            conversationId: req.params.conversationId,
            messageId: message.messageId,
            status: 'sent',
          });
        } catch {
          /* socket chưa khởi tạo */
        }
      } catch { /* socket chưa khởi tạo hoặc lỗi broadcast */ }
      sendCreated(res, message);
    } catch (error) {
      console.error('[sendMessage]', error);
      next(error);
    }
  },

  editMessage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { content, conversationId, createdAt } = req.body as {
        content: string;
        conversationId: string;
        createdAt: string;
      };
      await messageService.editMessage(
        req.params.messageId,
        content,
        req.user!.userId,
        conversationId,
        createdAt,
      );
      try {
        await emitToConversationAndMembers(conversationId, 'message:edited', {
          messageId: req.params.messageId,
          conversationId,
          content,
        });
      } catch { /* socket chưa khởi tạo */ }
      sendSuccess(res, null, 'Chỉnh sửa thành công');
    } catch (error) {
      console.error('[editMessage]', error);
      next(error);
    }
  },

  deleteMessage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { conversationId, createdAt } = req.body as { conversationId: string; createdAt: string };
      await messageService.deleteMessage(
        req.params.messageId,
        req.user!.userId,
        conversationId,
        createdAt,
      );
      try {
        getIO().to(`user:${req.user!.userId}`).emit('message:hidden_for_me', {
          messageId: req.params.messageId,
          conversationId,
        });
      } catch { /* socket chưa khởi tạo */ }
      sendSuccess(res, null, 'Xóa thành công');
    } catch (error) {
      console.error('[deleteMessage]', error);
      next(error);
    }
  },

  recallMessage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { conversationId, createdAt } = req.body as { conversationId: string; createdAt: string };
      await messageService.recallMessage(
        req.params.messageId,
        req.user!.userId,
        conversationId,
        createdAt,
      );
      try {
        const recallPayload = {
          messageId: req.params.messageId,
          conversationId,
        };
        await emitEventsToConversationAndMembers(conversationId, [
          { event: 'message:recall', payload: recallPayload },
          { event: 'message:recalled', payload: recallPayload },
          {
            event: 'message:pin_updated',
            payload: {
              messageId: req.params.messageId,
              conversationId,
              isPinned: false,
            },
          },
        ]);
      } catch { /* socket chưa khởi tạo */ }
      sendSuccess(res, null, 'Thu hồi thành công');
    } catch (error) {
      console.error('[recallMessage]', error);
      next(error);
    }
  },

  markAsRead: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { messageId } = req.body as { messageId: string };
      await messageService.markAsRead(req.params.conversationId, req.user!.userId, messageId);
      sendSuccess(res, null, 'Đã đánh dấu đã đọc');
    } catch (error) {
      console.error('[markAsRead]', error);
      next(error);
    }
  },

  pinMessage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { conversationId, createdAt } = req.body as { conversationId: string; createdAt: string };
      await groupService.assertUserMayPinMessage(req.user!.userId, conversationId);
      await messageService.pinMessage(req.params.messageId, conversationId, createdAt);
      try {
        await emitToConversationAndMembers(conversationId, 'message:pin_updated', {
          messageId: req.params.messageId,
          conversationId,
          isPinned: true,
        });
      } catch { /* socket chưa khởi tạo */ }
      sendSuccess(res, null, 'Đã ghim tin nhắn');
    } catch (error) {
      console.error('[pinMessage]', error);
      next(error);
    }
  },

  unpinMessage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = req.body as { conversationId?: string; createdAt?: string };
      const q = req.query as { conversationId?: string; createdAt?: string };
      const conversationId = (body.conversationId ?? q.conversationId) as string;
      const createdAt = (body.createdAt ?? q.createdAt) as string;
      await groupService.assertUserMayPinMessage(req.user!.userId, conversationId);
      await messageService.unpinMessage(req.params.messageId, conversationId, createdAt);
      try {
        await emitToConversationAndMembers(conversationId, 'message:pin_updated', {
          messageId: req.params.messageId,
          conversationId,
          isPinned: false,
        });
      } catch { /* socket chưa khởi tạo */ }
      sendSuccess(res, null, 'Đã bỏ ghim tin nhắn');
    } catch (error) {
      console.error('[unpinMessage]', error);
      next(error);
    }
  },

  reactToMessage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { conversationId, createdAt, emoji } = req.body as { conversationId: string; createdAt: string; emoji: string };
      const reactions = await messageService.reactToMessage(req.params.messageId, req.user!.userId, conversationId, createdAt, emoji);
      try {
        const reactionPayload = {
          messageId: req.params.messageId,
          conversationId,
          reactions,
        };
        await emitEventsToConversationAndMembers(conversationId, [
          { event: 'message:reacted', payload: reactionPayload },
          { event: 'message:reaction', payload: reactionPayload },
        ]);
      } catch { /* socket chưa khởi tạo */ }
      sendSuccess(res, reactions, 'Đã thả cảm xúc');
    } catch (error) {
      console.error('[reactToMessage]', error);
      next(error);
    }
  },
};
