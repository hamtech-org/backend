import { z } from 'zod';

const LIVE_CATEGORY = z.enum(['tech', 'study', 'entertainment', 'sales', 'chat', 'other']);
const LIVE_COVER_COLOR = z.enum(['blue', 'green', 'purple', 'orange', 'gray']);

export const createLiveSessionBodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  category: LIVE_CATEGORY.optional(),
  coverImageUrl: z.string().url().optional(),
  coverColor: LIVE_COVER_COLOR.optional(),
});

export const patchLiveSessionBodySchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    category: LIVE_CATEGORY.optional(),
    coverImageUrl: z.string().url().optional(),
    coverColor: LIVE_COVER_COLOR.optional(),
  })
  .refine(
    (b) =>
      b.title !== undefined ||
      b.category !== undefined ||
      b.coverImageUrl !== undefined ||
      b.coverColor !== undefined,
    { message: 'Ít nhất một trường cập nhật' },
  );

export const sessionIdParamsSchema = z.object({
  sessionId: z.string().uuid(),
});
