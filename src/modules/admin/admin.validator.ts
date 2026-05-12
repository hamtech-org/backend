import { z } from 'zod';

export const moderatePostSchema = z.object({
  action: z.enum(['approve', 'reject', 'warn', 'ban', 'delete']),
  reason: z.string().min(1).max(500),
});

export const moderateGroupSchema = z.object({
  action: z.enum(['approve', 'reject', 'warn', 'ban', 'delete']),
  reason: z.string().min(1).max(500),
});

export const analyticsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  interval: z.enum(['day', 'week', 'month']).optional(),
});

const MS_PER_DAY = 86_400_000;
const ANALYTICS_MAX_RANGE_DAYS = 90;

export const analyticsDashboardQuerySchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
    interval: z.enum(['hour', 'day', 'week', 'month']).optional(),
  })
  .superRefine((q, ctx) => {
    if (q.from && q.to) {
      const fromMs = new Date(q.from).getTime();
      const toMs = new Date(q.to).getTime();
      if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'from hoặc to không phải ngày hợp lệ',
        });
        return;
      }
      if (toMs < fromMs) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'to phải sau hoặc bằng from',
          path: ['to'],
        });
      }
      const days = (toMs - fromMs) / MS_PER_DAY;
      if (days > ANALYTICS_MAX_RANGE_DAYS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Khoảng thời gian tối đa ${ANALYTICS_MAX_RANGE_DAYS} ngày`,
          path: ['to'],
        });
      }
    }
  });
