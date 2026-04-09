import { Request, Response, NextFunction } from 'express';
import { chatService } from './chat.service.js';
import { sendSuccess, sendCreated } from '@/shared/utils/response.js';

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

  getMessages: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const messages = await chatService.getMessages(req.params.conversationId);
      sendSuccess(res, messages);
    } catch (error) { next(error); }
  },

  sendMessage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const message = await chatService.sendMessage(req.user!.userId, req.params.conversationId, req.body);
      sendCreated(res, message);
    } catch (error) { next(error); }
  },

  editMessage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { content } = req.body as { content: string };
      await chatService.editMessage(req.params.messageId, content);
      sendSuccess(res, null, 'Chỉnh sửa thành công');
    } catch (error) { next(error); }
  },

  deleteMessage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await chatService.deleteMessage(req.params.messageId);
      sendSuccess(res, null, 'Xóa thành công');
    } catch (error) { next(error); }
  },

  recallMessage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await chatService.recallMessage(req.params.messageId);
      sendSuccess(res, null, 'Thu hồi thành công');
    } catch (error) { next(error); }
  },
};
