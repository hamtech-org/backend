import type { INotification, NotificationType } from './notification.types.js';

/** Loại chỉ hiển thị ở tab Tin nhắn (unread hội thoại), không cộng vào badge chuông. */
export const BELL_EXCLUDED_NOTIFICATION_TYPES: NotificationType[] = ['message'];

export function countsTowardBell(type: NotificationType): boolean {
  return !BELL_EXCLUDED_NOTIFICATION_TYPES.includes(type);
}

export function countBellUnread(notifications: INotification[]): number {
  return notifications.filter((n) => !n.isRead && countsTowardBell(n.type)).length;
}
