import { Request, Response, NextFunction } from 'express';
import { pollService } from './poll.service.js';
import { sendSuccess, sendCreated } from '@/shared/utils/response.js';
import { emitToConversationAndMembers } from '../shared/chat.broadcast.js';

export const pollController = {
  createPoll: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      /** `pollService.createPoll` → `createAndBroadcastSystemMessage` đã `broadcastMessageNew` — không gọi lại (tránh message:new + banner đúp trên client). */
      await pollService.createPoll(req.user!.userId, req.params.groupId, req.body);
      try {
        await emitToConversationAndMembers(req.params.groupId, 'group:poll_new', { groupId: req.params.groupId });
      } catch {
        /* ignore socket */
      }
      sendCreated(res, null, 'Tạo bình chọn thành công');
    } catch (error) {
      console.error('[createPoll]', error);
      next(error);
    }
  },

  getPolls: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const polls = await pollService.getPolls(req.params.groupId);
      sendSuccess(res, polls);
    } catch (error) {
      console.error('[getPolls]', error);
      next(error);
    }
  },

  votePoll: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { optionIndex } = req.body;
      await pollService.votePoll(req.user!.userId, req.params.groupId, req.params.pollId, optionIndex);
      try {
        await emitToConversationAndMembers(req.params.groupId, 'group:poll_updated', {
          groupId: req.params.groupId,
          pollId: req.params.pollId,
        });
      } catch {
        /* ignore socket */
      }
      sendSuccess(res, null, 'Đã bình chọn');
    } catch (error) {
      console.error('[votePoll]', error);
      next(error);
    }
  },

  unvotePoll: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { optionIndex } = req.body;
      await pollService.unvotePoll(req.user!.userId, req.params.groupId, req.params.pollId, optionIndex);
      try {
        await emitToConversationAndMembers(req.params.groupId, 'group:poll_updated', {
          groupId: req.params.groupId,
          pollId: req.params.pollId,
        });
      } catch {
        /* ignore socket */
      }
      sendSuccess(res, null, 'Đã rút phiếu');
    } catch (error) {
      console.error('[unvotePoll]', error);
      next(error);
    }
  },

  addPollOption: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { text } = req.body;
      await pollService.addPollOption(req.user!.userId, req.params.groupId, req.params.pollId, text);
      try {
        await emitToConversationAndMembers(req.params.groupId, 'group:poll_updated', {
          groupId: req.params.groupId,
          pollId: req.params.pollId,
        });
      } catch {
        /* ignore socket */
      }
      sendSuccess(res, null, 'Đã thêm lựa chọn');
    } catch (error) {
      console.error('[addPollOption]', error);
      next(error);
    }
  },

  closePoll: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await pollService.closePoll(req.user!.userId, req.params.groupId, req.params.pollId);
      try {
        await emitToConversationAndMembers(req.params.groupId, 'group:poll_updated', {
          groupId: req.params.groupId,
          pollId: req.params.pollId,
        });
      } catch {
        /* ignore socket */
      }
      sendSuccess(res, null, 'Đã đóng bình chọn');
    } catch (error) {
      console.error('[closePoll]', error);
      next(error);
    }
  },
};
