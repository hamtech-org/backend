import { userRepository } from './user.repository.js';
import type { IUser, IUserPublic, IUpdateProfileDto } from './user.types.js';
import { NotFoundError } from '@/shared/utils/errors.js';

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
    return userRepository.update(userId, data);
  },

  searchUsers: async (query: string, limit: number = 10, offset: number = 0): Promise<IUserPublic[]> => {
    const users = await userRepository.search(query, limit, offset);
    return users.map(toPublicProfile);
  },

  getMultipleUsers: async (userIds: string[]): Promise<IUserPublic[]> => {
    const users = await userRepository.findMultipleById(userIds);
    return users.map(toPublicProfile);
  },
};
