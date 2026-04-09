import { Request, Response, NextFunction } from 'express';
import { aiService } from './ai.service.js';
import { sendSuccess } from '@/shared/utils/response.js';
import type { IAiSuggestRequest, IAiChatbotRequest, IAiGeneratePostRequest } from './ai.types.js';

export const aiController = {
  suggestContent: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await aiService.suggestContent(req.body as IAiSuggestRequest);
      sendSuccess(res, result);
    } catch (error) { next(error); }
  },

  chatbot: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await aiService.chatbot(req.body as IAiChatbotRequest);
      sendSuccess(res, result);
    } catch (error) { next(error); }
  },

  analyzeSentiment: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { text } = req.body as { text: string };
      const result = await aiService.analyzeSentiment(text);
      sendSuccess(res, result);
    } catch (error) { next(error); }
  },

  generatePost: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await aiService.generatePost(req.body as IAiGeneratePostRequest);
      sendSuccess(res, result);
    } catch (error) { next(error); }
  },
};
