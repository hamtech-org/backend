export type MetricType = 'users' | 'engagement' | 'posts' | 'groups';
export type ModerationAction = 'approve' | 'reject' | 'warn' | 'ban' | 'delete';
export type ModerationTarget = 'post' | 'group' | 'user' | 'comment';

export interface IAnalyticsMetric {
  metricType: MetricType;
  date: string;
  value: number;
  change: number;
  details: Record<string, unknown>;
}

export interface IModerateAction {
  action: ModerationAction;
  reason: string;
}

export interface IModerationLog {
  logId: string;
  adminId: string;
  targetType: ModerationTarget;
  targetId: string;
  action: ModerationAction;
  reason: string;
  createdAt: string;
}

export interface IResourceSummary {
  totalUsers: number;
  activeUsers: number;
  totalPosts: number;
  totalGroups: number;
  totalMessages: number;
  storageUsed: number;
}

export type AdminAnalyticsInterval = 'hour' | 'day' | 'week' | 'month';

export interface IAdminAnalyticsDashboardQuery {
  from?: string;
  to?: string;
  interval?: AdminAnalyticsInterval;
}

export interface ITimeSeriesPoint {
  t: string;
  count: number;
}

export interface IHourlyPoint {
  /** Bucket start (ISO), unique per ES date_histogram bucket */
  t: string;
  /** UTC hour-of-day of bucket start (for compact labels) */
  hour: number;
  count: number;
}

export interface IGroupChatMetricRow {
  conversationId: string;
  messageCount: number;
  name: string | null;
}

export interface INamedValue {
  name: string;
  value: number;
}

export interface IAdminAnalyticsDashboard {
  meta: {
    from: string;
    to: string;
    interval: AdminAnalyticsInterval;
    source: 'elasticsearch' | 'unavailable';
  };
  kpi: {
    totalMessages: number;
    totalPosts: number;
    groupConversationsWithMessages: number;
    peakHourUtc: string | null;
  };
  messagesByInterval: ITimeSeriesPoint[];
  messagesByHour: IHourlyPoint[];
  groupChatTop: IGroupChatMetricRow[];
  postsByInterval: ITimeSeriesPoint[];
  postsByType: INamedValue[];
}
