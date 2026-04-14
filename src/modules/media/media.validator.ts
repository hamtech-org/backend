import { z } from 'zod';

export const uploadBodySchema = z.object({
  mediaType: z.enum(['image', 'video', 'audio', 'file']),
});

export const uploadMultiBodySchema = z.object({
  mediaType: z.enum(['image', 'video', 'audio', 'file']).optional(),
});
