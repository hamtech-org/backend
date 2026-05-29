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
  | 'community_chat_enabled'
  | 'community_invite'
  | 'community_invite_accepted'
  | 'community_join_request'
  | 'community_request_resolved'
  | 'community_member_kicked'
  | 'community_role_changed'
  | 'community_ownership_transferred'
  | 'call_missed';

export type NotificationRoute =
  | 'chat'
  | 'post'
  | 'reel'
  | 'friends'
  | 'profile'
  | 'community'
  | 'notifications'
  | 'call'
  | 'live'
  | 'ai';

export interface INotificationRouteData {
  route: NotificationRoute;
  id: string;
  deepLink?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  actorName?: string;
  actorAvatar?: string | null;
  senderId?: string;
  senderName?: string;
  senderAvatar?: string | null;
  messageId?: string;
  messagePreview?: string;
  conversationType?: 'direct' | 'group';
  chatScope?: 'direct' | 'group';
  conversationName?: string | null;
  conversationAvatar?: string | null;
  groupName?: string | null;
  groupAvatar?: string | null;
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
