import { z } from 'zod';

export const getRtcTokenSchema = z.object({
  query: z.object({
    channelName: z.string().min(1).max(64),
    role: z.enum(['publisher', 'subscriber']).optional(),
  }),
});

export type GetRtcTokenQuery = z.infer<typeof getRtcTokenSchema>['query'];
