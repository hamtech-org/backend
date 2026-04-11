import { userRepository } from './user.repository.js';
import type { IUser, IUserPublic, IUpdateProfileDto } from './user.types.js';
import { NotFoundError } from '@/shared/utils/errors.js';
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
};
