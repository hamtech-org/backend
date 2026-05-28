import { contactRepository } from './contact.repository.js';
import { userRepository } from '../user/user.repository.js';
import type { IGroup, ICreateGroupDto } from './contact.types.js';

export const contactService = {
  getFriends: async (
    userId: string,
  ): Promise<
    Array<{
      userId: string;
      friendId: string;
      contactStatus: string;
      requestedBy: string;
      createdAt: string;
      displayName: string;
      avatar: string | null;
      email: string;
      phone: string | null;
      status: string;
    }>
  > => {
    const contacts = await contactRepository.getFriends(userId);

    if (contacts.length === 0) {
      console.log('⚠️ No contacts found');
      return [];
    }

    // Extract friend IDs from contacts
    const friendIds = contacts.map((c) => c.friendId);

    // Fetch user profiles for all friends
    const friendProfiles = await userRepository.findMultipleById(friendIds);

    // Create a map for quick lookup
    const profileMap = new Map(friendProfiles.map((p) => [p.userId, p]));

    // Enrich contacts with user profile data
    return contacts.map((contact) => {
      const profile = profileMap.get(contact.friendId);
      return {
        userId: contact.friendId,
        friendId: contact.friendId,
        contactStatus: contact.status, // Friendship status (pending/accepted/blocked)
        requestedBy: contact.requestedBy,
        createdAt: contact.createdAt,
        displayName: profile?.displayName || profile?.email || 'Unknown',
        avatar: profile?.avatar || null,
        email: profile?.email || '',
        phone: profile?.phone || null,
        status: profile?.status || 'offline', // User presence status (online/offline/away)
      };
    });
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
