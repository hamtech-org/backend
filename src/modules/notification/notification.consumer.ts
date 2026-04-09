import { logger } from '@/shared/utils/logger.js';
import { notificationService } from './notification.service.js';
import type { INotificationEvent } from './notification.types.js';

const TOPIC = 'notification.events';

export const startNotificationConsumer = async (): Promise<void> => {
  // TODO: Khởi tạo Kafka consumer, subscribe vào topic
  // const consumer = kafka.consumer({ groupId: 'notification-service' });
  // await consumer.connect();
  // await consumer.subscribe({ topic: TOPIC, fromBeginning: false });

  logger.info(`Notification consumer đã subscribe topic: ${TOPIC}`);

  // TODO: Xử lý từng message
  // await consumer.run({
  //   eachMessage: async ({ message }) => {
  //     const event = JSON.parse(message.value!.toString()) as INotificationEvent;
  //     await notificationService.processNotificationEvent(event);
  //   },
  // });

  void notificationService;
};
