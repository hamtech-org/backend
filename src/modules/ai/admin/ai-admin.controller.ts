import type { NextFunction, Request, Response } from 'express';
import { sendSuccess } from '@/shared/utils/response.js';
import { aiAdminService } from './ai-admin.service.js';
import { updateAiAdminConfigSchema } from './ai-admin.schema.js';

export const aiAdminController = {
  getDashboard: async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const [config, usage, audits] = await Promise.all([
        aiAdminService.getConfig(),
        aiAdminService.getUsageSummary(),
        aiAdminService.listAudits(),
      ]);
      sendSuccess(res, { config, usage, audits });
    } catch (error) {
      next(error);
    }
  },

  updateConfig: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const patch = updateAiAdminConfigSchema.parse(req.body ?? {});
      const config = await aiAdminService.updateConfig(patch, req.user!.userId);
      sendSuccess(res, config);
    } catch (error) {
      next(error);
    }
  },
};
