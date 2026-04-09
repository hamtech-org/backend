import { z } from 'zod';

export const sendFriendRequestSchema = z.object({
  userId: z.string().uuid(),
});

export const createGroupSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  type: z.enum(['public', 'private']),
  isApprovalRequired: z.boolean().optional(),
  memberIds: z.array(z.string().uuid()).optional(),
});

export const updateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  avatar: z.string().url().optional(),
});

export const addMembersSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1),
});
