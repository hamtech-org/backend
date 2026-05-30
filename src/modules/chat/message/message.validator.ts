import { z } from 'zod';

/** PK `CONV#{id}` — chấp nhận UUID (hội thoại app) và id seed/legacy (ví dụ `seed-conv-alice-bob`). */
export const conversationIdBodySchema = z.string().min(1).max(128);

const mediaishTypes = ['image', 'video', 'file', 'audio', 'voice'] as const;

export const sendMessageSchema = z
  .object({
    type: z.enum([
      'text',
      'image',
      'video',
      'file',
      'sticker',
      'emoji',
      'location',
      'poll',
      'schedule',
      'call',
      'voice',
    ]),
    content: z.string().max(10000),
    mediaUrl: z.string().url().optional(),
    mediaId: z.string().uuid().optional(),
    replyTo: z.string().uuid().optional(),
    duration: z.number().nonnegative().optional(),
    mentions: z.array(z.string()).max(500).optional().default([]),
  })
  .refine(
    (data) => {
      if (!mediaishTypes.includes(data.type as (typeof mediaishTypes)[number])) return true;
      return !!(data.mediaUrl ?? data.mediaId);
    },
    { message: 'Tin có media cần mediaUrl hoặc mediaId', path: ['mediaId'] },
  );

/** ISO từ Dynamo/client — không dùng `.datetime()` nghiêm để tránh 400 khi format hơi lệch; server resolve tin theo `messageId` + fallback query. */
const createdAtBodySchema = z.string().min(1).max(128);

export const editMessageSchema = z.object({
  content: z.string().min(1).max(10000),
  conversationId: conversationIdBodySchema,
  createdAt: createdAtBodySchema,
});

export const deleteMessageSchema = z.object({
  conversationId: conversationIdBodySchema,
  createdAt: createdAtBodySchema,
});

export const recallMessageSchema = z.object({
  conversationId: conversationIdBodySchema,
  createdAt: createdAtBodySchema,
});

export const markAsReadSchema = z.object({
  messageId: z.string().min(1),
});

export const reactMessageSchema = z.object({
  conversationId: conversationIdBodySchema,
  createdAt: createdAtBodySchema,
  emoji: z.string().min(1).max(20),
});
