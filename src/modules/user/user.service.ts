import { userRepository } from './user.repository.js';
import type {
  IUser,
  IUserPublic,
  IUpdateProfileDto,
  IFriendshipResponse,
  IFriendsList,
  IPendingRequests,
  IFriendRequestResponse,
} from './user.types.js';
import { NotFoundError, ConflictError, ValidationError } from '@/shared/utils/errors.js';
import { getKafkaProducer } from '@/config/kafka.js';
import { getIO } from '@/socket/index.js';
import { logger } from '@/shared/utils/logger.js';
import { putObject, deleteObjectKey, getSignedGetUrl } from '@/shared/services/s3Media.service.js';
import { v4 as uuidv4 } from 'uuid';
import { buildPublicCdnUrl } from '@/shared/services/cloudfrontSigner.service.js';
import { notificationService } from '@/modules/notification/notification.service.js';

/**
 * Emit search index event to Kafka for Elasticsearch synchronization
 */
const emitSearchIndexEvent = async (
  action: 'index' | 'update' | 'delete',
  user: IUser | null,
): Promise<void> => {
  try {
    if (!user) return;

    const producer = getKafkaProducer();

    await producer.send({
      topic: 'search.index',
      messages: [
        {
          key: user.userId,
          value: JSON.stringify({
            action,
            indexName: 'users',
            documentId: user.userId,
            document:
              action === 'delete'
                ? null
                : {
                    userId: user.userId,
                    displayName: user.displayName,
                    email: user.email,
                    avatar: user.avatar || null,
                    bio: user.bio || null,
                    status: user.status,
                    isVerified: user.isVerified,
                    createdAt: user.createdAt,
                    updatedAt: user.updatedAt,
                  },
          }),
        },
      ],
    });

    logger.info(`Emitted '${action}' event for user ${user.userId} to Elasticsearch`);
  } catch (error) {
    logger.error(`Failed to emit search index event for user ${user?.userId}:`, error);
    // Don't throw - let the operation continue even if Kafka fails
  }
};

const toPublicProfile = (user: IUser): IUserPublic => ({
  userId: user.userId,
  displayName: user.displayName,
  avatar: user.avatar,
  bio: user.bio,
  status: user.status,
  lastSeen: user.lastSeen,
});

export const userService = {
  getUserById: async (userId: string): Promise<IUser | null> => {
    return userRepository.findById(userId);
  },

  getPublicProfile: async (userId: string): Promise<IUserPublic> => {
    const user = await userRepository.findById(userId);
    if (!user) throw new NotFoundError('Người dùng');
    return toPublicProfile(user);
  },

  updateProfile: async (userId: string, data: IUpdateProfileDto): Promise<IUser> => {
    const updateData: IUpdateProfileDto = {
      displayName: data.displayName,
      bio: data.bio,
      phone: data.phone,
    };

    // Handle avatar upload to S3
    if (data.avatarFile) {
      try {
        // Validate file is an image
        if (!data.avatarFile.mimetype?.startsWith('image/')) {
          throw new ValidationError('Chỉ chấp nhận file ảnh');
        }

        // Upload to S3
        const avatarId = uuidv4();
        const ext = data.avatarFile.mimetype === 'image/jpeg' ? '.jpg' : '.png';
        const s3Key = `public/avatars/${userId}/${avatarId}${ext}`;

        await putObject({
          key: s3Key,
          body: data.avatarFile.buffer,
          contentType: data.avatarFile.mimetype,
        });

        updateData.avatar = buildPublicCdnUrl(s3Key) || (await getSignedGetUrl(s3Key, 604800));

        logger.info(`Avatar uploaded for user ${userId}: ${s3Key}`);
      } catch (error) {
        logger.error(`Failed to upload avatar for user ${userId}:`, error);
        if (error instanceof ValidationError) {
          throw error;
        }
        throw new Error('Không thể tải lên ảnh. Vui lòng thử lại.');
      }
    }

    const updated = await userRepository.update(userId, updateData);

    // Emit event to sync with Elasticsearch
    await emitSearchIndexEvent('update', updated);

    return updated;
  },

  searchUsers: async (
    query: string,
    limit: number = 10,
    offset: number = 0,
  ): Promise<IUserPublic[]> => {
    const users = await userRepository.search(query, limit, offset);
    return users.map(toPublicProfile);
  },

  getMultipleUsers: async (userIds: string[]): Promise<IUserPublic[]> => {
    const users = await userRepository.findMultipleById(userIds);
    return users.map(toPublicProfile);
  },

  /**
   * Emit search index event (used by auth/admin modules)
   */
  emitUserEvent: emitSearchIndexEvent,

  // ── Friend Request operations ──
  sendFriendRequest: async (senderId: string, receiverId: string): Promise<string> => {
    if (senderId === receiverId) {
      throw new ValidationError('Không thể gửi lời mời cho chính mình');
    }

    // Check if receiver exists
    const receiver = await userRepository.findById(receiverId);
    if (!receiver) {
      throw new NotFoundError('Người dùng');
    }

    // Check current status
    const status = await userRepository.getFriendRequestStatus(senderId, receiverId);

    if (status === 'friend') {
      throw new ConflictError('Bạn đã kết bạn với người này');
    }

    if (status === 'pending_sent') {
      throw new ConflictError('Bạn đã gửi lời mời cho người này');
    }

    // 'pending_received' or 'none' - allow sending
    if (status === 'pending_received') {
      // Auto-accept if they sent you a request
      await userRepository.acceptFriendRequest(senderId, receiverId);
      logger.info(`Auto-accepted friend request: ${senderId} <-> ${receiverId}`);

      // Emit socket events for auto-accept
      try {
        const io = getIO();
        io.to(`user:${receiverId}`).emit('friendRequest:accepted', {
          userId: senderId,
          timestamp: new Date(),
        });
        io.to(`user:${senderId}`).emit('friend:added', {
          friendId: receiverId,
          timestamp: new Date(),
        });
        io.to(`user:${receiverId}`).emit('friend:added', {
          friendId: senderId,
          timestamp: new Date(),
        });
      } catch (error) {
        logger.error('Failed to emit socket events for auto-accept:', error);
      }

      return 'Lời mời đã được chấp nhận tự động';
    }

    await userRepository.sendFriendRequest(senderId, receiverId);
    logger.info(`Friend request sent: ${senderId} -> ${receiverId}`);

    // Emit socket event to notify receiver in real-time
    try {
      const io = getIO();
      const sender = await userRepository.findById(senderId);
      const payload = {
        senderId,
        senderName: sender?.displayName || 'Unknown',
        senderAvatar: sender?.avatar || null,
        timestamp: new Date(),
      };
      io.to(`user:${receiverId}`).emit('friendRequest:new', payload);
      void notificationService
        .dispatch({
          type: 'friend_request',
          userId: receiverId,
          title: 'Lời mời kết bạn',
          body: `${payload.senderName} đã gửi lời mời kết bạn`,
          data: {
            route: 'friends',
            id: senderId,
            entityType: 'friends',
            entityId: senderId,
            deepLink: '/community',
            actorId: senderId,
            actorName: payload.senderName,
            actorAvatar: payload.senderAvatar,
            extra: {
              senderAvatar: payload.senderAvatar,
              actorId: senderId,
              actorName: payload.senderName,
              actorAvatar: payload.senderAvatar,
            },
          },
        })
        .catch((err) => logger.error('Friend request notification failed:', err));
    } catch (error) {
      logger.error('Failed to emit socket event for friend request:', error);
    }

    return 'Lời mời kết bạn đã được gửi';
  },

  acceptFriendRequest: async (userId: string, senderId: string): Promise<string> => {
    // Verify request exists
    const status = await userRepository.getFriendRequestStatus(userId, senderId);
    if (status !== 'pending_received') {
      throw new ValidationError('Không còn lời mời từ người này');
    }

    await userRepository.acceptFriendRequest(userId, senderId);
    logger.info(`Friend request accepted: ${senderId} <-> ${userId}`);

    // Emit socket events
    try {
      const io = getIO();
      io.to(`user:${senderId}`).emit('friendRequest:accepted', {
        userId,
        timestamp: new Date(),
      });

      // Notify both users about new friendship
      io.to(`user:${senderId}`).emit('friend:added', {
        friendId: userId,
        timestamp: new Date(),
      });
      io.to(`user:${userId}`).emit('friend:added', {
        friendId: senderId,
        timestamp: new Date(),
      });

      const accepter = await userRepository.findById(userId);
      void notificationService
        .dispatch({
          type: 'friend_accepted',
          userId: senderId,
          title: 'Kết bạn thành công',
          body: `${accepter?.displayName ?? 'Ai đó'} đã chấp nhận lời mời kết bạn`,
          data: {
            route: 'friends',
            id: userId,
            entityType: 'friends',
            entityId: userId,
            deepLink: '/community',
            actorId: userId,
            actorName: accepter?.displayName ?? undefined,
            actorAvatar: accepter?.avatar ?? null,
            extra: {
              actorId: userId,
              actorName: accepter?.displayName,
              actorAvatar: accepter?.avatar ?? null,
            },
          },
        })
        .catch((err) => logger.error('Friend accepted notification failed:', err));
    } catch (error) {
      logger.error('Failed to emit socket events for accept friend request:', error);
    }

    return 'Lời mời đã được chấp nhận';
  },

  rejectFriendRequest: async (userId: string, senderId: string): Promise<string> => {
    // Verify request exists
    const status = await userRepository.getFriendRequestStatus(userId, senderId);
    if (status !== 'pending_received') {
      throw new ValidationError('Không còn lời mời từ người này');
    }

    await userRepository.rejectFriendRequest(userId, senderId);
    logger.info(`Friend request rejected: ${userId} rejected ${senderId}`);

    // Emit socket event
    try {
      const io = getIO();
      io.to(`user:${senderId}`).emit('friendRequest:rejected', {
        userId,
        timestamp: new Date(),
      });
    } catch (error) {
      logger.error('Failed to emit socket events for reject friend request:', error);
    }

    return 'Lời mời đã bị từ chối';
  },

  cancelFriendRequest: async (senderId: string, receiverId: string): Promise<string> => {
    // Verify request exists
    const status = await userRepository.getFriendRequestStatus(senderId, receiverId);
    if (status !== 'pending_sent') {
      throw new ValidationError('Không có lời mời nào để hủy');
    }

    await userRepository.cancelFriendRequest(senderId, receiverId);
    logger.info(`Friend request cancelled: ${senderId} cancelled request to ${receiverId}`);
    return 'Lời mời đã bị hủy';
  },

  getFriendRequestStatus: async (
    userId: string,
    otherUserId: string,
  ): Promise<'friend' | 'pending_sent' | 'pending_received' | 'none'> => {
    return userRepository.getFriendRequestStatus(userId, otherUserId);
  },

  getPendingRequests: async (userId: string): Promise<IPendingRequests> => {
    const { received, sent } = await userRepository.getPendingRequests(userId);

    // Fetch user details for all pending requests
    const [receivedUsers, sentUsers] = await Promise.all([
      userRepository.findMultipleById(received),
      userRepository.findMultipleById(sent),
    ]);

    const receivedResponses: IFriendRequestResponse[] = receivedUsers.map((user) => ({
      userId: user.userId,
      displayName: user.displayName,
      avatar: user.avatar,
      bio: user.bio,
      requestStatus: 'received' as const,
      status: 'pending' as const,
      createdAt: user.createdAt,
    }));

    const sentResponses: IFriendRequestResponse[] = sentUsers.map((user) => ({
      userId: user.userId,
      displayName: user.displayName,
      avatar: user.avatar,
      bio: user.bio,
      requestStatus: 'sent' as const,
      status: 'pending' as const,
      createdAt: user.createdAt,
    }));

    return {
      received: receivedResponses,
      sent: sentResponses,
    };
  },

  removeFriend: async (userId: string, friendId: string): Promise<string> => {
    // Check if they're actually friends
    const isFriend = await userRepository.checkFriendship(userId, friendId);
    if (!isFriend) {
      throw new ValidationError('Bạn chưa kết bạn với người này');
    }

    await userRepository.removeFriend(userId, friendId);
    logger.info(`User ${userId} removed friend ${friendId}`);

    // Emit socket event to notify both users
    try {
      const io = getIO();
      io.to(`user:${userId}`).emit('friend:removed', {
        friendId,
        timestamp: new Date(),
      });
      io.to(`user:${friendId}`).emit('friend:removed', {
        userId,
        timestamp: new Date(),
      });
    } catch (error) {
      logger.error('Failed to emit socket events for remove friend:', error);
    }

    return 'Hủy kết bạn thành công';
  },

  getFriends: async (
    userId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<IFriendsList> => {
    // Check if user exists
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('Người dùng');
    }

    const friendIds = await userRepository.getFriendIds(userId, limit, offset);
    const friends = await userRepository.findMultipleById(friendIds);

    const friendsResponse: IFriendshipResponse[] = friends.map((friend) => ({
      userId: friend.userId,
      displayName: friend.displayName,
      avatar: friend.avatar,
      bio: friend.bio,
      status: 'friend',
      createdAt: friend.createdAt,
    }));

    return {
      userId,
      friends: friendsResponse,
      total: friendIds.length,
    };
  },

  checkFriendship: async (userId: string, friendId: string): Promise<boolean> => {
    return userRepository.checkFriendship(userId, friendId);
  },

  getSuggestedFriends: async (userId: string, limit: number = 10): Promise<IUser[]> => {
    // Get current user's friend IDs
    const friendIds = await userRepository.getFriendIds(userId, 1000); // Get all friends
    const friendIdsSet = new Set(friendIds);

    // Get pending requests (both sent and received)
    const { received, sent } = await userRepository.getPendingRequests(userId);
    const pendingIdsSet = new Set([...received, ...sent]);

    // Get all users (pagination would be ideal for production)
    const allUsers = await userRepository.findMultipleById([]);

    // Filter to get suggested users:
    // - Not the current user
    // - Not already a friend
    // - No pending request
    // - Verified users preferred
    const suggested = allUsers
      .filter(
        (user) =>
          user.userId !== userId &&
          !friendIdsSet.has(user.userId) &&
          !pendingIdsSet.has(user.userId) &&
          user.isVerified !== false,
      )
      .sort((a, b) => {
        // Prefer verified users with bio
        const scoreA = (a.isVerified ? 2 : 0) + (a.bio ? 1 : 0);
        const scoreB = (b.isVerified ? 2 : 0) + (b.bio ? 1 : 0);
        return scoreB - scoreA;
      })
      .slice(0, limit);

    logger.info(`GetSuggestedFriends for ${userId}: found ${suggested.length} suggestions`);
    return suggested;
  },

  updateUserStatus: async (
    userId: string,
    status: 'online' | 'offline' | 'away',
  ): Promise<void> => {
    await userRepository.update(userId, {
      status,
      ...{ lastSeen: new Date().toISOString() },
    });
    logger.debug(`User ${userId} status updated to ${status}`);
  },
};
