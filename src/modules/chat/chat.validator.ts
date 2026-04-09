import { z } from 'zod';

export const createConversationSchema = z.object({
  type: z.enum(['direct', 'group']),
  name: z.string().min(1).max(100).optional(),
  memberIds: z.array(z.string().uuid()).min(1),
});

export const sendMessageSchema = z.object({
  type: z.enum(['text', 'image', 'video', 'file', 'sticker', 'emoji', 'location', 'poll', 'schedule']),
  content: z.string().max(10000),
  mediaUrl: z.string().url().optional(),
  replyTo: z.string().uuid().optional(),
});

export const editMessageSchema = z.object({
  content: z.string().min(1).max(10000),
});
