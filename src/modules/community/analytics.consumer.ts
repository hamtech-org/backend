import { kafka } from '@/config/kafka.js';
import { logger } from '@/shared/utils/logger.js';
import { KAFKA_TOPICS } from '@/shared/constants/kafkaTopics.js';
import { communityRepository } from './community.repository.js';

interface IAnalyticsEvent {
  type:
    | 'MEMBER_JOINED'
    | 'MEMBER_LEFT'
    | 'POST_CREATED'
    | 'POST_DELETED'
    | 'COMMENT_CREATED'
    | 'COMMENT_DELETED';
  groupId: string;
  timestamp: number;
}

export const startAnalyticsConsumer = async (): Promise<void> => {
  const consumer = kafka.consumer({ groupId: 'community-analytics-processor' });

  await consumer.connect();
  await consumer.subscribe({ topic: KAFKA_TOPICS.ANALYTICS_EVENTS, fromBeginning: false });

  logger.info('📊 Analytics consumer started, listening for analytics events...');

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        if (!message.value) return;
        const event = JSON.parse(message.value.toString()) as IAnalyticsEvent;

        if (!event.groupId || !event.timestamp || !event.type) {
          logger.warn('Skipping invalid analytics event:', event);
          return;
        }

        const dateStr = new Date(event.timestamp).toISOString().split('T')[0];
        logger.debug(
          `Processing analytics event ${event.type} for group ${event.groupId} on ${dateStr}`,
        );

        switch (event.type) {
          case 'MEMBER_JOINED':
            await communityRepository.incrementAnalyticsCounter(
              event.groupId,
              dateStr,
              'newMembersCount',
              1,
            );
            break;
          case 'MEMBER_LEFT':
            await communityRepository.incrementAnalyticsCounter(
              event.groupId,
              dateStr,
              'leftMembersCount',
              1,
            );
            break;
          case 'POST_CREATED':
            await communityRepository.incrementAnalyticsCounter(
              event.groupId,
              dateStr,
              'postsCount',
              1,
            );
            break;
          case 'POST_DELETED':
            await communityRepository.incrementAnalyticsCounter(
              event.groupId,
              dateStr,
              'postsCount',
              -1,
            );
            break;
          case 'COMMENT_CREATED':
            await communityRepository.incrementAnalyticsCounter(
              event.groupId,
              dateStr,
              'commentsCount',
              1,
            );
            break;
          case 'COMMENT_DELETED':
            await communityRepository.incrementAnalyticsCounter(
              event.groupId,
              dateStr,
              'commentsCount',
              -1,
            );
            break;
          default:
            logger.warn('Unknown analytics event type:', event.type);
        }
      } catch (error) {
        logger.error('Error processing community analytics event:', error);
      }
    },
  });
};
