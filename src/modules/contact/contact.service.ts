import { contactRepository } from './contact.repository.js';
import type { IContact, IGroup, ICreateGroupDto } from './contact.types.js';

export const contactService = {
  getFriends: async (userId: string): Promise<IContact[]> => {
    return contactRepository.getFriends(userId);
  },

  sendFriendRequest: async (_userId: string, _targetUserId: string): Promise<void> => {
    // TODO: Tạo friend request, gửi notification
    throw new Error('Chưa triển khai');
  },

  acceptFriendRequest: async (_userId: string, _requestId: string): Promise<void> => {
    // TODO: Chấp nhận kết bạn
    throw new Error('Chưa triển khai');
  },

  removeFriend: async (userId: string, friendId: string): Promise<void> => {
    await contactRepository.removeFriend(userId, friendId);
    await contactRepository.removeFriend(friendId, userId);
  },

  getGroups: async (userId: string): Promise<IGroup[]> => {
    return contactRepository.getGroups(userId);
  },

  createGroup: async (_creatorId: string, _data: ICreateGroupDto): Promise<IGroup> => {
    // TODO: Tạo group + conversation + thêm members
    throw new Error('Chưa triển khai');
  },
};
