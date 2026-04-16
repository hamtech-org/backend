import { z } from 'zod';

export const updateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  avatar: z.string().url().optional(),
}).refine((data) => data.name !== undefined || data.avatar !== undefined, {
  message: 'Phải cung cấp ít nhất một trường để cập nhật (name hoặc avatar)',
});

export const addMembersSchema = z.object({
  memberIds: z.array(z.string().uuid()).min(1),
});

export const changeRoleSchema = z.object({
  role: z.enum(['owner', 'admin', 'member']),
});
