import { getKafkaConsumer } from '@/config/kafka.js';
import { logger } from '@/shared/utils/logger.js';
import type { KafkaTopic } from '@/shared/constants/kafkaTopics.js';

type MessageHandler = (payload: Record<string, unknown>) => Promise<void>;

export const kafkaConsumer = {
  subscribe: async (topic: KafkaTopic, handler: MessageHandler): Promise<void> => {
    try {
      const consumer = getKafkaConsumer();
      await consumer.subscribe({ topic, fromBeginning: false });

      await consumer.run({
        eachMessage: async ({ message }) => {
          if (!message.value) return;

          try {
            const payload = JSON.parse(message.value.toString()) as Record<string, unknown>;
            await handler(payload);
          } catch (error) {
            logger.error(`Kafka consume lỗi [${topic}]:`, error);
          }
        },
      });
    } catch (error) {
      logger.error(`Kafka subscribe lỗi [${topic}]:`, error);
    }
  },
};
