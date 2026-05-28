import { kafka } from '@/config/kafka.js';
import { KAFKA_TOPICS } from '@/shared/constants/kafkaTopics.js';
import { logger } from '@/shared/utils/logger.js';
import { notificationService } from './notification.service.js';
import { communityRepository } from '../community/community.repository.js';

export const startNotificationConsumer = async (): Promise<void> => {
  const consumer = kafka.consumer({ groupId: 'notification-service' });

  await consumer.connect();
  await consumer.subscribe({ topic: KAFKA_TOPICS.NOTIFICATION_EVENTS, fromBeginning: false });
  await consumer.subscribe({ topic: KAFKA_TOPICS.NOTIFICATION_FANOUT, fromBeginning: false });

  logger.info(
    `Notification consumer subscribed to: ${KAFKA_TOPICS.NOTIFICATION_EVENTS} & ${KAFKA_TOPICS.NOTIFICATION_FANOUT}`,
  );

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      try {
        if (!message.value) return;
        const raw = JSON.parse(message.value.toString()) as Record<string, unknown>;

        if (topic === KAFKA_TOPICS.NOTIFICATION_FANOUT) {
          const { type, groupId, conversationId } = raw as {
            type: string;
            groupId: string;
            conversationId: string;
          };

          if (type === 'community_chat_enabled') {
            const community = await communityRepository.getCommunityById(groupId);
            if (!community) {
              logger.warn(`Fan-out aborted: community ${groupId} not found.`);
              return;
            }

            const members = await communityRepository.listMembers(groupId);
            logger.info(
              `Fan-out notifications to ${members.length} members of community ${groupId}`,
            );

            // Gửi notification bất đồng bộ cho từng active member
            await Promise.all(
              members.map((member) =>
                notificationService
                  .dispatch({
                    type: 'community_chat_enabled',
                    userId: member.userId,
                    title: 'Phòng chat cộng đồng đã được bật',
                    body: `Cộng đồng "${community.name}" đã kích hoạt phòng chat. Hãy tham gia ngay!`,
                    data: {
                      route: 'community',
                      id: groupId,
                      extra: {
                        joinChat: 'true',
                        conversationId,
                      },
                    },
                  })
                  .catch((err) => {
                    logger.error(
                      `Failed to dispatch fan-out notification to user ${member.userId}:`,
                      err,
                    );
                  }),
              ),
            );
          }
        } else {
          await notificationService.processKafkaMessage(raw);
        }
      } catch (error) {
        logger.error('Notification consumer error:', error);
      }
    },
  });
};
