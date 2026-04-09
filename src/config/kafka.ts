import { Kafka, Producer, Consumer } from 'kafkajs';
import { env } from './env.js';
import { logger } from '@/shared/utils/logger.js';

const kafka = new Kafka({
  clientId: env.KAFKA_CLIENT_ID,
  brokers: env.KAFKA_BROKERS.split(','),
});

let producer: Producer;
let consumer: Consumer;

export const connectKafka = async (): Promise<void> => {
  try {
    producer = kafka.producer();
    consumer = kafka.consumer({ groupId: env.KAFKA_GROUP_ID });

    await producer.connect();
    logger.info('Kafka Producer kết nối thành công');
  } catch (error) {
    logger.warn('Kafka không khả dụng, bỏ qua kết nối:', error);
  }
};

export const getKafkaProducer = (): Producer => {
  if (!producer) throw new Error('Kafka Producer chưa được khởi tạo');
  return producer;
};

export const getKafkaConsumer = (): Consumer => {
  if (!consumer) {
    consumer = kafka.consumer({ groupId: env.KAFKA_GROUP_ID });
  }
  return consumer;
};

export { kafka };
