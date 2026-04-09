import { z } from 'zod';

export const uploadSchema = z.object({
  mediaType: z.enum(['image', 'video', 'audio', 'file']),
});

export const uploadMultiSchema = z.object({
  mediaType: z.enum(['image', 'video', 'audio', 'file']),
  count: z.number().int().min(1).max(10).optional(),
});
