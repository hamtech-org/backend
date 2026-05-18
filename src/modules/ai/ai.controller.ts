import { Request, Response, NextFunction } from 'express';
import { aiService } from './ai.service.js';
import { aiAssistantRepository } from './ai-assistant.repository.js';
import { sendSuccess } from '@/shared/utils/response.js';
import type {
  IAiSuggestRequest,
  IAiChatbotRequest,
  IAiGeneratePostRequest,
  IAiSuggestReplyContextRequest,
  IAiGroupSummaryRequest,
  IAiAssistantRequest,
} from './ai.types.js';

export const aiController = {
  suggestContent: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await aiService.suggestContent(req.body as IAiSuggestRequest);
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  },

  suggestReplyFromContext: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await aiService.suggestReplyFromContext(
        req.body as IAiSuggestReplyContextRequest,
      );
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  },

  summarizeGroupMessages: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await aiService.summarizeGroupMessages({
        ...(req.body as IAiGroupSummaryRequest),
        userId: req.user!.userId,
      });
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  },

  chatbot: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await aiService.chatbot(req.body as IAiChatbotRequest);
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  },

  analyzeSentiment: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { text } = req.body as { text: string };
      const result = await aiService.analyzeSentiment(text);
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  },

  generatePost: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await aiService.generatePost(req.body as IAiGeneratePostRequest);
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  },

  aiAssistant: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = req.body as { message?: string; threadId?: string; locale?: 'vi' | 'en' };
      const payload: IAiAssistantRequest = {
        userId: req.user!.userId,
        message: String(body.message ?? ''),
        ...(body.threadId ? { threadId: body.threadId } : {}),
        ...(body.locale ? { locale: body.locale } : {}),
      };
      const result = await aiService.aiAssistant(payload);
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  },

  getAiAssistantThread: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const q = typeof req.query.threadId === 'string' ? req.query.threadId.trim() : '';
      const threadId =
        q.length > 0 ? q : await aiAssistantRepository.getOrCreateDefaultThreadId(userId);
      if (q.length > 0) {
        await aiAssistantRepository.assertThreadOwnedByUser(userId, threadId);
      }
      const messages = await aiAssistantRepository.listRecentMessages(threadId, 80);
      sendSuccess(res, { threadId, messages });
    } catch (error) {
      next(error);
    }
  },
};
