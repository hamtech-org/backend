import { conversationRepository } from '../conversation/conversation.repository.js';
import { memberRequestRepository } from './member-request.repository.js';
import { NotFoundError, ForbiddenError } from '@/shared/utils/errors.js';
import { userRepository } from '@/modules/user/user.repository.js';
import { contactRepository } from '@/modules/contact/contact.repository.js';
import { createAndBroadcastSystemMessage } from '../shared/system-message.factory.js';
import { resolveChatMemberLabel } from '../shared/chat.helpers.js';

const sysMsgDeps = {
  createMessage: conversationRepository.createMessage,
  updateConversationLastMessage: conversationRepository.updateConversationLastMessage,
};

export const memberRequestService = {
  joinRequest: async (userId: string, conversationId: string): Promise<void> => {
    const conv = await conversationRepository.getConversationById(conversationId);
    if (!conv) throw new NotFoundError('Hội thoại');
    await memberRequestRepository.createGroupRequest(conversationId, userId);
  },

  getGroupRequests: async (conversationId: string, requesterId: string): Promise<any[]> => {
    const member = await conversationRepository.getMember(conversationId, requesterId);
    if (!member || !['owner', 'admin'].includes(member.role)) {
      throw new ForbiddenError('Chỉ Admin/Owner mới xem được danh sách chờ');
    }
    const [requests, members] = await Promise.all([
      memberRequestRepository.getGroupRequests(conversationId),
      conversationRepository.getConversationMembers(conversationId),
    ]);
    const memberIdSet = new Set(members.map((m) => m.userId));

    const staleRequests = requests.filter((r) => memberIdSet.has(r.userId));
    if (staleRequests.length > 0) {
      await Promise.all(
        staleRequests.map((r) =>
          memberRequestRepository.removeGroupRequest(conversationId, r.userId),
        ),
      );
    }

    const pendingRequests = requests.filter((r) => !memberIdSet.has(r.userId));
    if (!pendingRequests.length) return [];

    // Enrich: trả về name/avatar để FE hiển thị đúng tên dù chưa kết bạn.
    const userIds = pendingRequests.map((r) => r.userId).filter(Boolean);
    let users: any[] = [];
    try {
      users = await userRepository.findByIds(userIds);
    } catch {
      users = [];
    }
    const byId = new Map(users.map((u) => [u.userId, u]));

    // Check friend status
    let friendSet = new Set<string>();
    try {
      const friends = await contactRepository.getFriends(requesterId);
      friendSet = new Set(friends.map((f) => f.friendId));
    } catch {
      friendSet = new Set();
    }

    return pendingRequests.map((r) => {
      const u = byId.get(r.userId);
      return {
        ...r,
        name: u?.displayName ?? u?.email ?? r.userId,
        avatar: u?.avatar ?? null,
        isFriend: friendSet.has(r.userId),
      };
    });
  },

  approveRequest: async (
    conversationId: string,
    requesterId: string,
    targetUserId: string,
  ): Promise<{ memberCount: number }> => {
    const member = await conversationRepository.getMember(conversationId, requesterId);
    if (!member || !['owner', 'admin'].includes(member.role)) {
      throw new ForbiddenError('Chỉ Admin/Owner mới có quyền duyệt');
    }

    const exists = await conversationRepository.getMember(conversationId, targetUserId);
    if (exists) {
      await memberRequestRepository.removeGroupRequest(conversationId, targetUserId);
      await memberRequestRepository.clearKickedMember(conversationId, targetUserId);
      const members = await conversationRepository.getConversationMembers(conversationId);
      return { memberCount: members.length };
    }

    const now = new Date().toISOString();
    await conversationRepository.addConversationMember({
      conversationId,
      userId: targetUserId,
      role: 'member',
      joinedAt: now,
      unreadCount: 0,
      isMuted: false,
      isPinnedToTop: false,
    });

    const members = await conversationRepository.getConversationMembers(conversationId);
    const memberCount = members.length;
    await conversationRepository.updateConversation(conversationId, {
      memberCount,
    });

    await memberRequestRepository.removeGroupRequest(conversationId, targetUserId);
    await memberRequestRepository.clearKickedMember(conversationId, targetUserId);

    // System message: thành viên được duyệt vào nhóm
    try {
      let targetName = resolveChatMemberLabel(targetUserId, null);
      try {
        const users = await userRepository.findByIds([targetUserId]);
        targetName = resolveChatMemberLabel(targetUserId, users[0] ?? null);
      } catch {
        /* ignore */
      }

      await createAndBroadcastSystemMessage(
        { conversationId, senderId: requesterId, content: `${targetName} đã tham gia nhóm` },
        sysMsgDeps,
      );
    } catch { /* ignore */ }

    return { memberCount };
  },

  rejectRequest: async (
    conversationId: string,
    requesterId: string,
    targetUserId: string,
  ): Promise<void> => {
    const member = await conversationRepository.getMember(conversationId, requesterId);
    if (!member || !['owner', 'admin'].includes(member.role)) {
      throw new ForbiddenError('Chỉ Admin/Owner mới có quyền từ chối');
    }
    await memberRequestRepository.removeGroupRequest(conversationId, targetUserId);
  },
};
