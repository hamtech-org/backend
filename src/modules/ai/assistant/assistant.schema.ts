import { z } from 'zod';

export const aiAssistantThreadJoinSchema = z.object({
  threadId: z.string().uuid().optional(),
});

export const aiAssistantMessageSendSchema = z.object({
  threadId: z.string().uuid().optional(),
  requestId: z.string().min(1).max(120).optional(),
  message: z.string().trim().min(1).max(10000),
  locale: z.enum(['vi', 'en']).optional(),
});

export const aiAssistantMessageCancelSchema = z.object({
  threadId: z.string().uuid().optional(),
  requestId: z.string().min(1).max(120),
});
