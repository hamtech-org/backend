import { z } from 'zod';

/** PK `CONV#{id}` — chấp nhận UUID (hội thoại app) và id seed/legacy (ví dụ `seed-conv-alice-bob`). */
export const conversationIdBodySchema = z.string().min(1).max(128);

export const createConversationSchema = z.object({
  type: z.enum(['direct', 'group']),
  name: z.string().min(1).max(100).optional(),
  avatar: z.string().url().optional(),
  memberIds: z.array(z.string().uuid()).min(1),
});

export const updateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  avatar: z.string().url().optional(),
}).refine((data) => data.name !== undefined || data.avatar !== undefined, {
  message: 'Phải cung cấp ít nhất một trường để cập nhật (name hoặc avatar)',
});

export const sendMessageSchema = z.object({
  type: z.enum(['text', 'image', 'video', 'file', 'sticker', 'emoji', 'location', 'poll', 'schedule']),
  content: z.string().max(10000),
  mediaUrl: z.string().url().optional(),
  replyTo: z.string().uuid().optional(),
});

export const editMessageSchema = z.object({
  content: z.string().min(1).max(10000),
  conversationId: conversationIdBodySchema,
  createdAt: z.string().datetime(),
});

export const deleteMessageSchema = z.object({
  conversationId: conversationIdBodySchema,
  createdAt: z.string().datetime(),
});

export const recallMessageSchema = z.object({
  conversationId: conversationIdBodySchema,
  createdAt: z.string().datetime(),
});

export const markAsReadSchema = z.object({
  messageId: z.string().uuid(),
});

export const reactMessageSchema = z.object({
  conversationId: conversationIdBodySchema,
  createdAt: z.string().datetime(),
  emoji: z.string().min(1).max(20),
});
export const addMembersSchema = z.object({
  memberIds: z.array(z.string().uuid()).min(1),
});

export const changeRoleSchema = z.object({
  role: z.enum(['owner', 'admin', 'member']),
});
