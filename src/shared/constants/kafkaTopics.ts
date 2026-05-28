export const KAFKA_TOPICS = {
  NOTIFICATION_EVENTS: 'notification.events',
  SEARCH_INDEX: 'search.index',
  ANALYTICS_EVENTS: 'analytics.events',
  AI_REQUESTS: 'ai.requests',
  MEDIA_EVENTS: 'media.events',
  COMMUNITY_EVENTS: 'community.events',
  NOTIFICATION_FANOUT: 'notification.fanout',
} as const;

export type KafkaTopic = (typeof KAFKA_TOPICS)[keyof typeof KAFKA_TOPICS];
