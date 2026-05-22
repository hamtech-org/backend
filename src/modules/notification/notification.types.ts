export type NotificationType =
  | 'friend_request'
  | 'friend_accepted'
  | 'message'
  | 'group_invite'
  | 'post_reaction'
  | 'post_comment'
  | 'mention'
  | 'system'
  | 'reel_new'
  | 'reel_comment'
  | 'live_started'
  | 'comment_reply'
  | 'ai_job_done'
  | 'stats_milestone'
  | 'post_approved'
  | 'post_rejected'
  | 'community_chat_enabled';

export type NotificationRoute =
  | 'chat'
  | 'post'
  | 'reel'
  | 'friends'
  | 'profile'
  | 'community'
  | 'notifications'
  | 'live'
  | 'ai';

export interface INotificationRouteData {
  route: NotificationRoute;
  id: string;
  extra?: Record<string, unknown>;
}

export interface INotification {
  notificationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data: INotificationRouteData & Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
  expiresAt: string | null;
  /** DynamoDB sort key — dùng khi mark read */
  sortKey?: string;
}

export interface INotificationEvent {
  type: NotificationType;
  userId: string;
  title: string;
  body: string;
  data: INotificationRouteData & Record<string, unknown>;
  skipPush?: boolean;
}

/** Kafka batch: một sự kiện cho nhiều người nhận (vd. tin nhắn mới). */
export interface INotificationKafkaMessage {
  type: NotificationType;
  recipientIds: string[];
  title: string;
  body: string;
  data: INotificationRouteData & Record<string, unknown>;
  skipPush?: boolean;
}

export type PushPlatform = 'ios' | 'android' | 'web';

export interface IDevicePushToken {
  userId: string;
  token: string;
  platform: PushPlatform;
  createdAt: string;
  updatedAt: string;
}
