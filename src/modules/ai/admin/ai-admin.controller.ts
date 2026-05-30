import type { NextFunction, Request, Response } from 'express';
import { sendSuccess } from '@/shared/utils/response.js';
import { aiAdminService } from './ai-admin.service.js';
import { updateAiAdminConfigSchema } from './ai-admin.schema.js';
import type { AiUsageInterval, AiUsageRange } from './ai-admin.types.js';

const usageRanges = new Set<AiUsageRange>(['day', 'week', 'month']);
const usageIntervals = new Set<AiUsageInterval>(['hour', 'day', 'week', 'month']);

function firstQueryValue(value: Request['query'][string]): string | undefined {
  if (Array.isArray(value)) return String(value[0]);
  if (typeof value === 'string') return value;
  return undefined;
}

export const aiAdminController = {
  getDashboard: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rangeValue = firstQueryValue(req.query.range);
      const intervalValue = firstQueryValue(req.query.interval);
      const range = usageRanges.has(rangeValue as AiUsageRange)
        ? (rangeValue as AiUsageRange)
        : undefined;
      const interval = usageIntervals.has(intervalValue as AiUsageInterval)
        ? (intervalValue as AiUsageInterval)
        : undefined;
      const [config, usage, audits] = await Promise.all([
        aiAdminService.getConfig(),
        aiAdminService.getUsageSummary({ range, interval }),
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
