import { z } from 'zod';

/** 12 ký tự hex từ randomBytes(6) — có thể mở rộng sau. */
export const joinLinkSuffixParamSchema = z.object({
  suffix: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-f0-9]{8,32}$/, 'Link không hợp lệ'),
});
