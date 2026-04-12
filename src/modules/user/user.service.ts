import { userRepository } from './user.repository.js';
import type { IUser, IUserPublic, IUpdateProfileDto, IFriendshipResponse, IFriendsList, IPendingRequests } from './user.types.js';
import { NotFoundError, ConflictError, ValidationError } from '@/shared/utils/errors.js';
import { getKafkaProducer } from '@/config/kafka.js';
import { logger } from '@/shared/utils/logger.js';

/**
 * Emit search index event to Kafka for Elasticsearch synchronization
 */
const emitSearchIndexEvent = async (
  action: 'index' | 'update' | 'delete',
  user: IUser | null
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
    const updated = await userRepository.update(userId, data);

    // Emit event to sync with Elasticsearch
    await emitSearchIndexEvent('update', updated);

    return updated;
  },

  searchUsers: async (query: string, limit: number = 10, offset: number = 0): Promise<IUserPublic[]> => {
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
      return 'Lời mời đã được chấp nhận tự động';
    }

    await userRepository.sendFriendRequest(senderId, receiverId);
    logger.info(`Friend request sent: ${senderId} -> ${receiverId}`);
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

  getFriendRequestStatus: async (userId: string, otherUserId: string): Promise<'friend' | 'pending_sent' | 'pending_received' | 'none'> => {
    return userRepository.getFriendRequestStatus(userId, otherUserId);
  },

  getPendingRequests: async (userId: string): Promise<IPendingRequests> => {
    const { received, sent } = await userRepository.getPendingRequests(userId);
    
    // Fetch user details for all pending requests
    const [receivedUsers, sentUsers] = await Promise.all([
      userRepository.findMultipleById(received),
      userRepository.findMultipleById(sent),
    ]);

    const receivedResponses: IFriendRequestResponse[] = receivedUsers.map(user => ({
      userId: user.userId,
      displayName: user.displayName,
      avatar: user.avatar,
      bio: user.bio,
      requestStatus: 'received' as const,
      status: 'pending' as const,
      createdAt: user.createdAt,
    }));

    const sentResponses: IFriendRequestResponse[] = sentUsers.map(user => ({
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
    return 'Hủy kết bạn thành công';
  },

  getFriends: async (userId: string, limit: number = 50, offset: number = 0): Promise<IFriendsList> => {
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
};
