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
