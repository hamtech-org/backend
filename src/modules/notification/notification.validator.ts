import { z } from 'zod';

export const registerDeviceTokenSchema = z.object({
  token: z.string().min(10).max(512),
  platform: z.enum(['ios', 'android', 'web']),
  provider: z.enum(['expo', 'fcm']).default('expo'),
  deviceId: z.string().trim().min(8).max(128).optional(),
});

export const markNotificationReadParamsSchema = z.object({
  notificationId: z.string().uuid(),
});

export const listNotificationsQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional(),
});
