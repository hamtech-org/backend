import { kafka } from '@/config/kafka.js';
import { KAFKA_TOPICS } from '@/shared/constants/kafkaTopics.js';
import { logger } from '@/shared/utils/logger.js';
import { communityRepository } from './community.repository.js';
import { conversationRepository } from '@/modules/chat/conversation/conversation.repository.js';
import { createAndBroadcastSystemMessage } from '@/modules/chat/shared/system-message.factory.js';
import { userRepository } from '@/modules/user/user.repository.js';
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
          kickedBy?: string;
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

            // 1. Cập nhật bản ghi META trong database để đóng băng chat (chatEnabled = false)
            await conversationRepository.updateConversation(conversationId, {
              chatEnabled: false,
            });

            logger.info(
              `Conversation ${conversationId} chat feature disabled due to community archive.`,
            );

            // 2. Phát sự kiện WebSocket group:updated tới room chung để cập nhật UI
            try {
              const io = getIO();
              io.to(`conv:${conversationId}`).emit('group:updated', {
                conversationId,
                chatEnabled: false,
              });
            } catch (socketErr) {
              logger.error(`Failed to emit group:updated socket event:`, socketErr);
            }
            break;
          }

          case 'member_left':
          case 'member_kicked': {
            const { userId, kickedBy } = payload;
            if (!userId) break;

            const community = await communityRepository.getCommunityById(groupId);
            if (!community || !community.conversationId) {
              logger.debug(
                `Community ${groupId} has no conversationId linked. Skipping member sync.`,
              );
              break;
            }

            const conversationId = community.conversationId;
            const chatMember = await conversationRepository.getMember(conversationId, userId);
            if (!chatMember) {
              logger.debug(`User ${userId} is not in the linked chat. No need to remove.`);
              break;
            }

            // Xóa thành viên khỏi phòng chat
            await conversationRepository.removeMember(conversationId, userId);

            // Cập nhật lại số lượng thành viên của conversation
            const membersAfter =
              await conversationRepository.getConversationMembers(conversationId);
            const memberCount = membersAfter.length;
            await conversationRepository.updateConversation(conversationId, { memberCount });

            // Gửi tin nhắn hệ thống
            try {
              let targetName = 'Ai đó';
              let actorName = 'Admin';
              try {
                const userIds = [userId];
                if (kickedBy) userIds.push(kickedBy);
                const users = await userRepository.findByIds(userIds);
                const userMap = new Map(users.map((u) => [u.userId, u]));
                targetName = userMap.get(userId)?.displayName || userId;
                if (kickedBy) {
                  actorName = userMap.get(kickedBy)?.displayName || kickedBy;
                }
              } catch (err) {
                logger.error('Failed to fetch user profiles for system message:', err);
              }

              const sysContent =
                type === 'member_kicked'
                  ? `${actorName} đã mời ${targetName} ra khỏi nhóm`
                  : `${targetName} đã rời nhóm`;

              await createAndBroadcastSystemMessage(
                {
                  conversationId,
                  senderId: kickedBy || userId,
                  content: sysContent,
                },
                {
                  createMessage: conversationRepository.createMessage,
                  updateConversationLastMessage:
                    conversationRepository.updateConversationLastMessage,
                },
              );
            } catch (sysErr) {
              logger.error(
                'Failed to create and broadcast system message for community leave/kick:',
                sysErr,
              );
            }

            // Emit socket notification
            try {
              const io = getIO();
              const socketEvent =
                type === 'member_kicked' ? 'group:member_removed' : 'group:member_left';
              const socketPayload = {
                conversationId,
                groupId: conversationId,
                userId,
                kickedBy,
                memberCount,
              };

              io.to(`conv:${conversationId}`).emit(socketEvent, socketPayload);
              io.to(`user:${userId}`).emit(socketEvent, socketPayload);

              for (const m of membersAfter) {
                io.to(`user:${m.userId}`).emit(socketEvent, socketPayload);
                io.to(`user:${m.userId}`).emit('group:updated', {
                  conversationId,
                  memberCount,
                });
              }
            } catch (socketErr) {
              logger.error(
                'Failed to emit socket updates for community member leave/kick:',
                socketErr,
              );
            }

            logger.info(
              `Synced ${type} for user ${userId} from community ${groupId} to chat ${conversationId}`,
            );
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
