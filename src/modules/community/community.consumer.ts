import { kafka } from '@/config/kafka.js';
import { KAFKA_TOPICS } from '@/shared/constants/kafkaTopics.js';
import { logger } from '@/shared/utils/logger.js';
import { communityRepository } from './community.repository.js';
import { conversationRepository } from '@/modules/chat/conversation/conversation.repository.js';
import { getIO } from '@/socket/index.js';

/**
 * Ánh xạ vai trò từ Cộng đồng sang Phòng chat
 */
const mapCommunityRoleToChat = (
  role: 'owner' | 'admin' | 'moderator' | 'member',
): 'owner' | 'admin' | 'member' => {
  if (role === 'owner') return 'owner';
  if (role === 'admin' || role === 'moderator') return 'admin';
  return 'member';
};

export const startCommunityConsumer = async (): Promise<void> => {
  const consumer = kafka.consumer({ groupId: 'community-service' });

  await consumer.connect();
  await consumer.subscribe({ topic: KAFKA_TOPICS.COMMUNITY_EVENTS, fromBeginning: false });

  logger.info(`Community consumer subscribed: ${KAFKA_TOPICS.COMMUNITY_EVENTS}`);

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        if (!message.value) return;
        const payload = JSON.parse(message.value.toString()) as {
          type: string;
          groupId: string;
          userId?: string;
          role?: 'owner' | 'admin' | 'moderator' | 'member';
          oldOwnerId?: string;
          newOwnerId?: string;
          conversationId?: string | null;
        };

        const { type, groupId } = payload;
        logger.info(`Processing community event: ${type} for group ${groupId}`);

        switch (type) {
          case 'member_role_updated': {
            const { userId, role } = payload;
            if (!userId || !role) break;

            const community = await communityRepository.getCommunityById(groupId);
            if (!community || !community.conversationId) {
              logger.debug(
                `Community ${groupId} has no conversationId linked or does not exist. Skipping role sync.`,
              );
              break;
            }

            const conversationId = community.conversationId;
            // Kiểm tra xem thành viên đã gia nhập phòng chat chưa (Defer Join)
            const chatMember = await conversationRepository.getMember(conversationId, userId);
            if (!chatMember) {
              logger.debug(
                `User ${userId} has not joined the linked chat ${conversationId}. Role update deferred.`,
              );
              break;
            }

            const mappedRole = mapCommunityRoleToChat(role);
            await conversationRepository.updateMemberRole(conversationId, userId, mappedRole);
            logger.info(
              `Synced member role update for user ${userId} to chat ${conversationId} as ${mappedRole}`,
            );
            break;
          }

          case 'ownership_transferred': {
            const { oldOwnerId, newOwnerId } = payload;
            if (!oldOwnerId || !newOwnerId) break;

            const community = await communityRepository.getCommunityById(groupId);
            if (!community || !community.conversationId) {
              logger.debug(
                `Community ${groupId} has no conversationId linked. Skipping ownership transfer sync.`,
              );
              break;
            }

            const conversationId = community.conversationId;

            // Kiểm tra xem hai user đã gia nhập phòng chat chưa
            const isNewOwnerInChat =
              (await conversationRepository.getMember(conversationId, newOwnerId)) !== null;
            const isOldOwnerInChat =
              (await conversationRepository.getMember(conversationId, oldOwnerId)) !== null;

            if (isNewOwnerInChat && isOldOwnerInChat) {
              // Cả 2 đều ở trong chat, thực hiện transaction cập nhật đồng bộ
              await conversationRepository.applyGroupOwnerTransfer({
                conversationId,
                newOwnerUserId: newOwnerId,
                previousOwnerUserId: oldOwnerId,
                previousOwnerNewRole: 'admin', // Hạ cấp owner cũ xuống admin
              });
              logger.info(
                `Transferred ownership in chat ${conversationId} from ${oldOwnerId} to ${newOwnerId} (both users in chat)`,
              );
            } else {
              // Có ít nhất một người chưa vào chat. Thực hiện cập nhật thủ công từng phần để tránh lỗi transaction
              if (isNewOwnerInChat) {
                await conversationRepository.updateMemberRole(conversationId, newOwnerId, 'owner');
              }
              if (isOldOwnerInChat) {
                await conversationRepository.updateMemberRole(conversationId, oldOwnerId, 'admin');
              }
              // Leader của phòng chat luôn phải cập nhật chéo để đồng bộ quyền Leader
              await conversationRepository.updateConversation(conversationId, {
                leaderId: newOwnerId,
              });
              logger.info(
                `Partially transferred ownership in chat ${conversationId} to ${newOwnerId} (deferred active sync status)`,
              );
            }
            break;
          }

          case 'community_archived': {
            const { conversationId } = payload;
            if (!conversationId) {
              logger.debug(`Archived community ${groupId} has no linked conversation. Skipping.`);
              break;
            }

            // 1. Đánh dấu phòng chat đã bị xóa trong database
            await conversationRepository.updateConversation(conversationId, { isDeleted: true });
            logger.info(
              `Conversation ${conversationId} marked as isDeleted: true due to community archive.`,
            );

            // 2. Phát sự kiện WebSocket tới toàn bộ client đang kết nối trong phòng chat đó
            try {
              const io = getIO();
              io.to(`conversation:${conversationId}`).emit('conversation:disbanded', {
                conversationId,
                reason: 'community_archived',
              });
              logger.info(
                `Disbanded notification emitted via WebSockets to conversation room ${conversationId}`,
              );
            } catch (socketErr) {
              logger.error(`Failed to emit conversation:disbanded event via socket:`, socketErr);
            }
            break;
          }

          default:
            logger.warn(`Unknown community event type: ${type}`);
            break;
        }
      } catch (error) {
        logger.error('Error handling community event Kafka message:', error);
      }
    },
  });
};
