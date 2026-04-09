export type NotificationType =
  | 'friend_request'
  | 'friend_accepted'
  | 'message'
  | 'group_invite'
  | 'post_reaction'
  | 'post_comment'
  | 'mention'
  | 'system';

export interface INotification {
  notificationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
  expiresAt: string | null;
}

export interface INotificationEvent {
  type: NotificationType;
  userId: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}
