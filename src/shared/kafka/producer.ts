import { getKafkaProducer } from '@/config/kafka.js';
import { logger } from '@/shared/utils/logger.js';
import type { KafkaTopic } from '@/shared/constants/kafkaTopics.js';

export const kafkaProducer = {
  send: async (topic: KafkaTopic, payload: Record<string, unknown>): Promise<void> => {
    try {
      const producer = getKafkaProducer();
      await producer.send({
        topic,
        messages: [
          {
            key: (payload.userId as string) || undefined,
            value: JSON.stringify(payload),
          },
        ],
      });
    } catch (error) {
      logger.error(`Kafka produce lỗi [${topic}]:`, error);
    }
  },
};
