import { kafka } from '@/config/kafka.js';
import { KAFKA_TOPICS } from '@/shared/constants/kafkaTopics.js';
import { logger } from '@/shared/utils/logger.js';
import { notificationService } from './notification.service.js';

export const startNotificationConsumer = async (): Promise<void> => {
  const consumer = kafka.consumer({ groupId: 'notification-service' });

  await consumer.connect();
  await consumer.subscribe({ topic: KAFKA_TOPICS.NOTIFICATION_EVENTS, fromBeginning: false });

  logger.info(`Notification consumer subscribed: ${KAFKA_TOPICS.NOTIFICATION_EVENTS}`);

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        if (!message.value) return;
        const raw = JSON.parse(message.value.toString()) as Record<string, unknown>;
        await notificationService.processKafkaMessage(raw);
      } catch (error) {
        logger.error('Notification consumer error:', error);
      }
    },
  });
};
