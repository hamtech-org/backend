import { z } from 'zod';

export const createConversationSchema = z.object({
  type: z.enum(['direct', 'group']),
  name: z.string().min(1).max(100).optional(),
  avatar: z.string().url().optional(),
  memberIds: z.array(z.string().uuid()).min(1),
});

export const updateConversationPreferencesSchema = z
  .object({
    isMuted: z.boolean().optional(),
    isPinnedToTop: z.boolean().optional(),
    /** ISO-8601; `null` = xóa hẹn tắt tạm. */
    notificationsMutedUntil: z.union([z.string().datetime(), z.null()]).optional(),
    /** Tắt push tạm (không bật `isMuted` trừ khi client gửi kèm). */
    muteFor: z.enum(['1h', '4h', '8h']).optional(),
  })
  .refine(
    (b) =>
      b.isMuted !== undefined ||
      b.isPinnedToTop !== undefined ||
      b.notificationsMutedUntil !== undefined ||
      b.muteFor !== undefined,
    { message: 'Cần ít nhất một trường: isMuted, isPinnedToTop, notificationsMutedUntil, muteFor' },
  );
