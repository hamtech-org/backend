import { z } from 'zod';

export const updateProfileSchema = z.object({
  displayName: z.string().min(2).max(50).optional(),
  bio: z.string().max(500).optional(),
  avatar: z.string().url().optional(),
  phone: z.string().regex(/^\+84\d{9,10}$/, 'Số điện thoại không hợp lệ').optional(),
});

export const updateSettingsSchema = z.object({
  language: z.enum(['vi', 'en']).optional(),
  notifications: z.boolean().optional(),
  privacy: z.enum(['public', 'friends', 'private']).optional(),
});
