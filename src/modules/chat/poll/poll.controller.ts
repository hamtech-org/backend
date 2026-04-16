import { Request, Response, NextFunction } from 'express';
import { pollService } from './poll.service.js';
import { sendSuccess, sendCreated } from '@/shared/utils/response.js';
import { getIO } from '@/socket/index.js';
import { broadcastMessageNew } from '../shared/chat.broadcast.js';

export const pollController = {
  createPoll: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const systemMessage = await pollService.createPoll(req.user!.userId, req.params.groupId, req.body);
      try {
        if (systemMessage) {
          await broadcastMessageNew(systemMessage);
        }
      } catch { /* ignore */ }
      getIO().to(`conv:${req.params.groupId}`).emit('group:poll_new', { groupId: req.params.groupId });
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
      getIO().to(`conv:${req.params.groupId}`).emit('group:poll_updated', { groupId: req.params.groupId, pollId: req.params.pollId });
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
      getIO().to(`conv:${req.params.groupId}`).emit('group:poll_updated', { groupId: req.params.groupId, pollId: req.params.pollId });
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
      getIO().to(`conv:${req.params.groupId}`).emit('group:poll_updated', { groupId: req.params.groupId, pollId: req.params.pollId });
      sendSuccess(res, null, 'Đã thêm lựa chọn');
    } catch (error) {
      console.error('[addPollOption]', error);
      next(error);
    }
  },

  closePoll: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await pollService.closePoll(req.user!.userId, req.params.groupId, req.params.pollId);
      getIO().to(`conv:${req.params.groupId}`).emit('group:poll_updated', { groupId: req.params.groupId, pollId: req.params.pollId });
      sendSuccess(res, null, 'Đã đóng bình chọn');
    } catch (error) {
      console.error('[closePoll]', error);
      next(error);
    }
  },
};
