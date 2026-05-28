import { z } from 'zod';

export const uploadBodySchema = z.object({
  mediaType: z.enum(['image', 'video', 'audio', 'file']),
  deliveryScope: z.enum(['chat', 'general']).default('chat'),
});

export const uploadMultiBodySchema = z.object({
  mediaType: z.enum(['image', 'video', 'audio', 'file']).optional(),
  deliveryScope: z.enum(['chat', 'general']).default('chat'),
});
