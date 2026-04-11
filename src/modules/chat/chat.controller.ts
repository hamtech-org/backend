import { Request, Response, NextFunction } from 'express';
import { chatService } from './chat.service.js';
import { sendSuccess, sendCreated } from '@/shared/utils/response.js';
import { getIO } from '@/socket/index.js';

export const chatController = {
  getConversations: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const conversations = await chatService.getConversations(req.user!.userId);
      sendSuccess(res, conversations);
    } catch (error) { next(error); }
  },

  createConversation: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const conversation = await chatService.createConversation(req.user!.userId, req.body);
      sendCreated(res, conversation);
    } catch (error) { next(error); }
  },

  getConversation: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const conversation = await chatService.getConversationById(
        req.params.conversationId,
        req.user!.userId,
      );
      sendSuccess(res, conversation);
    } catch (error) { next(error); }
  },

  getMessages: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const messages = await chatService.getMessages(req.params.conversationId, limit);
      sendSuccess(res, messages);
    } catch (error) { next(error); }
  },

  sendMessage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const message = await chatService.sendMessage(
        req.user!.userId,
        req.params.conversationId,
        req.body,
      );
      // Broadcast tới tất cả thành viên đang kết nối trong phòng
      try {
        getIO().to(`conv:${req.params.conversationId}`).emit('message:new', message);
      } catch { /* socket chưa khởi tạo, bỏ qua */ }
      sendCreated(res, message);
    } catch (error) { next(error); }
  },

  editMessage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { content, conversationId, createdAt } = req.body as {
        content: string;
        conversationId: string;
        createdAt: string;
      };
      await chatService.editMessage(
        req.params.messageId,
        content,
        req.user!.userId,
        conversationId,
        createdAt,
      );
      try {
        getIO().to(`conv:${conversationId}`).emit('message:edited', {
          messageId: req.params.messageId,
          conversationId,
          content,
        });
      } catch { /* socket chưa khởi tạo */ }
      sendSuccess(res, null, 'Chỉnh sửa thành công');
    } catch (error) { next(error); }
  },

  deleteMessage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { conversationId, createdAt } = req.body as { conversationId: string; createdAt: string };
      await chatService.deleteMessage(
        req.params.messageId,
        req.user!.userId,
        conversationId,
        createdAt,
      );
      try {
        getIO().to(`conv:${conversationId}`).emit('message:deleted', {
          messageId: req.params.messageId,
          conversationId,
        });
      } catch { /* socket chưa khởi tạo */ }
      sendSuccess(res, null, 'Xóa thành công');
    } catch (error) { next(error); }
  },

  recallMessage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { conversationId, createdAt } = req.body as { conversationId: string; createdAt: string };
      await chatService.recallMessage(
        req.params.messageId,
        req.user!.userId,
        conversationId,
        createdAt,
      );
      try {
        getIO().to(`conv:${conversationId}`).emit('message:recall', {
          messageId: req.params.messageId,
          conversationId,
        });
      } catch { /* socket chưa khởi tạo */ }
      sendSuccess(res, null, 'Thu hồi thành công');
    } catch (error) { next(error); }
  },

  markAsRead: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { messageId } = req.body as { messageId: string };
      await chatService.markAsRead(req.params.conversationId, req.user!.userId, messageId);
      sendSuccess(res, null, 'Đã đánh dấu đã đọc');
    } catch (error) { next(error); }
  },

  pinMessage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { conversationId, createdAt } = req.body as { conversationId: string; createdAt: string };
      await chatService.pinMessage(req.params.messageId, conversationId, createdAt);
      try {
        getIO().to(`conv:${conversationId}`).emit('message:pin_updated', {
          messageId: req.params.messageId,
          conversationId,
          isPinned: true,
        });
      } catch { /* socket chưa khởi tạo */ }
      sendSuccess(res, null, 'Đã ghim tin nhắn');
    } catch (error) { next(error); }
  },

  unpinMessage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { conversationId, createdAt } = req.body as { conversationId: string; createdAt: string };
      await chatService.unpinMessage(req.params.messageId, conversationId, createdAt);
      try {
        getIO().to(`conv:${conversationId}`).emit('message:pin_updated', {
          messageId: req.params.messageId,
          conversationId,
          isPinned: false,
        });
      } catch { /* socket chưa khởi tạo */ }
      sendSuccess(res, null, 'Đã bỏ ghim tin nhắn');
    } catch (error) { next(error); }
  },
};
