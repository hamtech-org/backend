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
      'album',
    ]),
    content: z.string().max(10000),
    mediaUrl: z.string().url().optional(),
    mediaId: z.string().uuid().optional(),
    mediaIds: z.array(z.string().uuid()).min(2).max(10).optional(),
    sourceMessageId: z.string().uuid().optional(),
    sourceConversationId: conversationIdBodySchema.optional(),
    clientTempId: z.string().min(1).max(128).optional(),
    replyTo: z.string().uuid().optional(),
    duration: z.number().nonnegative().optional(),
    mentions: z.array(z.string()).max(500).optional().default([]),
  })
  .superRefine((data, ctx) => {
    // 1. Validate forward logic
    if (data.sourceMessageId && !data.sourceConversationId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Khi forward tin nhắn cần cung cấp sourceConversationId',
        path: ['sourceConversationId'],
      });
    }

    if (data.type === 'album') {
      if (!data.sourceMessageId && (!data.mediaIds || data.mediaIds.length < 2)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Tin nhắn album cần danh sách mediaIds từ 2 đến 10 ảnh/video',
          path: ['mediaIds'],
        });
      }
      if (data.mediaId || data.mediaUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Tin nhắn album không chấp nhận mediaId hoặc mediaUrl đơn lẻ',
          path: ['mediaId'],
        });
      }
    } else {
      if (data.mediaIds && data.mediaIds.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Chỉ tin nhắn album mới chấp nhận mảng mediaIds',
          path: ['mediaIds'],
        });
      }
      const mediaishTypes = ['image', 'video', 'file', 'voice'] as const;
      if (mediaishTypes.includes(data.type as any)) {
        if (!data.sourceMessageId && !data.mediaId && !data.mediaUrl) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Tin nhắn media cần mediaId hoặc mediaUrl',
            path: ['mediaId'],
          });
        }
      }
    }
  });

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
