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
