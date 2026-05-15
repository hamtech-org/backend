import { conversationRepository } from '../conversation/conversation.repository.js';
import { memberRequestRepository } from './member-request.repository.js';
import { NotFoundError, ForbiddenError } from '@/shared/utils/errors.js';
import { userRepository } from '@/modules/user/user.repository.js';
import { contactRepository } from '@/modules/contact/contact.repository.js';
import { createAndBroadcastSystemMessage } from '../shared/system-message.factory.js';
import { resolveChatMemberLabel } from '../shared/chat.helpers.js';
import {
  buildGroupMemberInvitedContent,
  buildGroupMemberJoinedContent,
} from '../shared/group-system-message.js';

const sysMsgDeps = {
  createMessage: conversationRepository.createMessage,
  updateConversationLastMessage: conversationRepository.updateConversationLastMessage,
};

/** Pill 1 khi duyệt — «X đã mời Y vào nhóm» (người mới vào cũng thấy). */
async function broadcastGroupMemberInvitedNotice(
  conversationId: string,
  inviterUserId: string,
  targetUserId: string,
): Promise<void> {
  let actorName = resolveChatMemberLabel(inviterUserId, null);
  let targetName = resolveChatMemberLabel(targetUserId, null);
  try {
    const users = await userRepository.findByIds([inviterUserId, targetUserId]);
    const byId = new Map(users.map((u) => [u.userId, u]));
    actorName = resolveChatMemberLabel(inviterUserId, byId.get(inviterUserId) ?? null);
    targetName = resolveChatMemberLabel(targetUserId, byId.get(targetUserId) ?? null);
  } catch {
    /* ignore */
  }

  await createAndBroadcastSystemMessage(
    {
      conversationId,
      senderId: inviterUserId,
      content: buildGroupMemberInvitedContent(
        { userId: inviterUserId, name: actorName },
        [{ userId: targetUserId, name: targetName }],
      ),
    },
    sysMsgDeps,
  );
}

/** Pill 2 khi duyệt — «Y đã tham gia nhóm». */
async function broadcastGroupMemberJoinedNotice(
  conversationId: string,
  targetUserId: string,
): Promise<void> {
  let targetName = resolveChatMemberLabel(targetUserId, null);
  try {
    const users = await userRepository.findByIds([targetUserId]);
    targetName = resolveChatMemberLabel(targetUserId, users[0] ?? null);
  } catch {
    /* ignore */
  }

  await createAndBroadcastSystemMessage(
    {
      conversationId,
      senderId: targetUserId,
      content: buildGroupMemberJoinedContent({ userId: targetUserId, name: targetName }),
    },
    sysMsgDeps,
  );
}

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
  ): Promise<{ memberCount: number; joinedAt: string }> => {
    const member = await conversationRepository.getMember(conversationId, requesterId);
    if (!member || !['owner', 'admin'].includes(member.role)) {
      throw new ForbiddenError('Chỉ Admin/Owner mới có quyền duyệt');
    }

    const trimmedTarget = targetUserId.trim();
    const wasKicked = await memberRequestRepository.isKickedMember(
      conversationId,
      trimmedTarget,
    );
    const exists = await conversationRepository.getMember(conversationId, trimmedTarget);

    if (exists && !wasKicked) {
      await memberRequestRepository.removeGroupRequest(conversationId, trimmedTarget);
      await memberRequestRepository.clearKickedMember(conversationId, trimmedTarget);
      const members = await conversationRepository.getConversationMembers(conversationId);
      return {
        memberCount: members.length,
        joinedAt: exists.joinedAt || new Date().toISOString(),
      };
    }

    const now = new Date().toISOString();
    await conversationRepository.removeAllMemberRecordsForUser(conversationId, trimmedTarget);
    await conversationRepository.addConversationMember({
      conversationId,
      userId: trimmedTarget,
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

    const pendingRequest = await memberRequestRepository.getGroupRequest(
      conversationId,
      trimmedTarget,
    );
    const inviterId = String(pendingRequest?.invitedBy ?? '').trim();

    await memberRequestRepository.removeGroupRequest(conversationId, trimmedTarget);
    await memberRequestRepository.clearKickedMember(conversationId, trimmedTarget);

    try {
      if (inviterId) {
        await broadcastGroupMemberInvitedNotice(conversationId, inviterId, trimmedTarget);
      }
      await broadcastGroupMemberJoinedNotice(conversationId, trimmedTarget);
    } catch {
      /* ignore */
    }

    return { memberCount, joinedAt: now };
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
