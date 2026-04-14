import { contactRepository } from './contact.repository.js';
import { userRepository } from '../user/user.repository.js';
import type { IContact, IGroup, ICreateGroupDto } from './contact.types.js';

export const contactService = {
  getFriends: async (userId: string): Promise<Array<{
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
  }>> => {
    console.log('👥 getFriends called for userId:', userId);
    const contacts = await contactRepository.getFriends(userId);
    console.log('📝 Contacts from repo:', contacts);
    
    if (contacts.length === 0) {
      console.log('⚠️ No contacts found');
      return [];
    }

    // Extract friend IDs from contacts
    const friendIds = contacts.map((c) => c.friendId);
    console.log('🔗 Friend IDs:', friendIds);
    
    // Fetch user profiles for all friends
    const friendProfiles = await userRepository.findMultipleById(friendIds);
    console.log('👤 Friend profiles:', friendProfiles);
    
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

  /**
   * MVP: Kết bạn ngay lập tức (auto-accept) để phục vụ UI "Kết bạn" trong modal thành viên nhóm.
   * Nếu muốn quy trình lời mời/duyệt kết bạn chuẩn, có thể mở rộng sau.
   */
  sendFriendRequest: async (userId: string, targetUserId: string): Promise<void> => {
    if (!targetUserId || targetUserId === userId) return;
    const now = new Date().toISOString();
    await Promise.all([
      contactRepository.addFriend({
        userId,
        friendId: targetUserId,
        status: 'accepted' as any,
        requestedBy: userId,
        createdAt: now,
      }),
      contactRepository.addFriend({
        userId: targetUserId,
        friendId: userId,
        status: 'accepted' as any,
        requestedBy: userId,
        createdAt: now,
      }),
    ]);
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
