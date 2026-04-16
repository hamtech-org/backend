import { Request, Response, NextFunction } from 'express';
import { memberRequestService } from './member-request.service.js';
import { sendSuccess } from '@/shared/utils/response.js';
import { getIO } from '@/socket/index.js';

export const memberRequestController = {
  joinRequest: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await memberRequestService.joinRequest(req.user!.userId, req.params.groupId);
      try {
        getIO().to(`conv:${req.params.groupId}`).emit('group:join_request_new', { groupId: req.params.groupId });
      } catch { /* ignore */ }
      sendSuccess(res, null, 'Đã gửi yêu cầu tham gia');
    } catch (error) {
      console.error('[joinRequest]', error);
      next(error);
    }
  },

  getGroupRequests: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const requests = await memberRequestService.getGroupRequests(req.params.groupId, req.user!.userId);
      sendSuccess(res, requests);
    } catch (error) {
      console.error('[getGroupRequests]', error);
      next(error);
    }
  },

  approveRequest: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await memberRequestService.approveRequest(req.params.groupId, req.user!.userId, req.params.userId);
      try {
        getIO().to(`conv:${req.params.groupId}`).emit('group:member_joined', {
          groupId: req.params.groupId,
          userId: req.params.userId,
        });
        getIO().to(`user:${req.params.userId}`).emit('group:request_approved', { groupId: req.params.groupId });
      } catch { /* ignore */ }
      sendSuccess(res, null, 'Đã duyệt thành viên');
    } catch (error) {
      console.error('[approveRequest]', error);
      next(error);
    }
  },

  rejectRequest: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await memberRequestService.rejectRequest(req.params.groupId, req.user!.userId, req.params.userId);
      try {
        getIO().to(`user:${req.params.userId}`).emit('group:request_rejected', { groupId: req.params.groupId });
        getIO().to(`conv:${req.params.groupId}`).emit('group:join_request_updated', { groupId: req.params.groupId });
      } catch { /* ignore */ }
      sendSuccess(res, null, 'Đã từ chối yêu cầu');
    } catch (error) {
      console.error('[rejectRequest]', error);
      next(error);
    }
  },
};
