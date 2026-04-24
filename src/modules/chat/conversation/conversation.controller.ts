import { Request, Response, NextFunction } from 'express';
import { conversationService } from './conversation.service.js';
import { sendSuccess, sendCreated } from '@/shared/utils/response.js';
import type { ICreateConversationDto } from '../shared/chat.types.js';

export const conversationController = {
  getConversations: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const conversations = await conversationService.getConversations(req.user!.userId);
      sendSuccess(res, conversations);
    } catch (error) {
      next(error);
    }
  },

  createConversation: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dto = req.body as unknown as ICreateConversationDto;
      const conversation = await conversationService.createConversation(req.user!.userId, dto);
      sendCreated(res, conversation);
    } catch (error) {
      next(error);
    }
  },

  getConversation: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const conversation = await conversationService.getConversationById(
        req.params.conversationId,
        req.user!.userId,
      );
      sendSuccess(res, conversation);
    } catch (error) {
      next(error);
    }
  },

  patchPreferences: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const prefs = req.body as unknown as {
        isMuted?: boolean;
        isPinnedToTop?: boolean;
        notificationsMutedUntil?: string | null;
        muteFor?: '1m' | '5m' | '10m';
      };
      await conversationService.updateMyConversationPreferences(
        req.user!.userId,
        req.params.conversationId,
        {
          isMuted: prefs.isMuted,
          isPinnedToTop: prefs.isPinnedToTop,
          notificationsMutedUntil: prefs.notificationsMutedUntil,
          muteFor: prefs.muteFor,
        },
      );
      sendSuccess(res, null);
    } catch (error) {
      next(error);
    }
  },

  getConversationMembers: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const members = await conversationService.getConversationMembers(
        req.params.conversationId,
        req.user!.userId,
      );
      sendSuccess(res, members);
    } catch (error) {
      next(error);
    }
  },
};
