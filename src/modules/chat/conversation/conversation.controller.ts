import { Request, Response, NextFunction } from 'express';
import { conversationService } from './conversation.service.js';
import { sendSuccess, sendCreated } from '@/shared/utils/response.js';

export const conversationController = {
  getConversations: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const conversations = await conversationService.getConversations(req.user!.userId);
      sendSuccess(res, conversations);
    } catch (error) { next(error); }
  },

  createConversation: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const conversation = await conversationService.createConversation(req.user!.userId, req.body);
      sendCreated(res, conversation);
    } catch (error) { next(error); }
  },

  getConversation: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const conversation = await conversationService.getConversationById(
        req.params.conversationId,
        req.user!.userId,
      );
      sendSuccess(res, conversation);
    } catch (error) {
      console.error('[getConversation]', error);
      next(error);
    }
  },
};
