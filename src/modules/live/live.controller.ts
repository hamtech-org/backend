import { NextFunction, Request, Response } from 'express';
import { sendSuccess } from '@/shared/utils/response.js';
import type { CreateLiveSessionInput, PatchLiveSessionInput } from './live.types.js';
import { liveService } from './live.service.js';

export const liveController = {
  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const body = req.body as CreateLiveSessionInput;
      const data = await liveService.createSession(userId, body);
      sendSuccess(res, data, 'Đã tạo phiên live');
    } catch (e) {
      next(e);
    }
  },

  list: async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await liveService.listActiveSessions();
      sendSuccess(res, data, 'Danh sách live');
    } catch (e) {
      next(e);
    }
  },

  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId } = req.params;
      const data = await liveService.getSessionById(sessionId);
      sendSuccess(res, data, 'Chi tiết phiên');
    } catch (e) {
      next(e);
    }
  },

  patch: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId } = req.params;
      const body = req.body as PatchLiveSessionInput;
      const data = await liveService.patchSession(sessionId, req.user!.userId, body);
      sendSuccess(res, data, 'Đã cập nhật');
    } catch (e) {
      next(e);
    }
  },

  end: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId } = req.params;
      await liveService.endSession(sessionId, req.user!.userId);
      sendSuccess(res, { ok: true }, 'Đã kết thúc phiên');
    } catch (e) {
      next(e);
    }
  },
};
