import { Request, Response, NextFunction } from 'express';
import { aiRecapService } from './ai-recap.service.js';
import { sendSuccess } from '@/shared/utils/response.js';
import { emitToConversationAndMembers } from '../shared/chat.broadcast.js';

export const aiRecapController = {
  generateAIRecap: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const summary = await aiRecapService.generateRecap(req.params.groupId);
      try {
        await emitToConversationAndMembers(req.params.groupId, 'group:recap_new', {
          groupId: req.params.groupId,
          summary,
        });
      } catch {
        /* ignore */
      }
      sendSuccess(res, summary, 'Tóm tắt thành công');
    } catch (error) {
      console.error('[generateAIRecap]', error);
      next(error);
    }
  },

  getLatestAIRecap: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const summary = await aiRecapService.getLatestRecap(req.params.groupId);
      sendSuccess(res, summary);
    } catch (error) {
      console.error('[getLatestAIRecap]', error);
      next(error);
    }
  },
};
