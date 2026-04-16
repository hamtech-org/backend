import { z } from 'zod';

export const createConversationSchema = z.object({
  type: z.enum(['direct', 'group']),
  name: z.string().min(1).max(100).optional(),
  avatar: z.string().url().optional(),
  memberIds: z.array(z.string().uuid()).min(1),
});
