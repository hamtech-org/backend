import { v4 as uuidv4 } from 'uuid';
import { conversationRepository } from './conversation.repository.js';
import { messageUserHideRepository } from '../message/message-user-hide.repository.js';
import type {
  IConversation,
  IConversationMember,
  ICreateConversationDto,
  MemberRole,
} from '../shared/chat.types.js';
import { NotFoundError, ForbiddenError } from '@/shared/utils/errors.js';
import { MAX_PINNED_CHATS_TO_TOP } from '../shared/chat.constants.js';
import { userRepository } from '@/modules/user/user.repository.js';
import {
  resolveLastVisibleLastMessageSnapshot,
  isConversationNotificationPushMuted,
} from '../shared/chat.helpers.js';
import { createAndBroadcastSystemMessage } from '../shared/system-message.factory.js';
import { createInitialGroupSettings } from '../group/group.service.js';

/** Nhóm đã giải tán không hiển thị trong danh sách hội thoại (kể cả khi còn sót bản ghi MEMBER#). */
function filterDisbandedGroupsFromList(conversations: IConversation[]): IConversation[] {
  return conversations.filter((c) => !(c.type === 'group' && c.isDeleted === true));
}

export const conversationService = {
  getConversations: async (userId: string): Promise<IConversation[]> => {
    const conversations = await conversationRepository.getConversations(userId);
    const hiddenByConv =
      await messageUserHideRepository.queryAllHiddenGroupedByConversation(userId);
    for (const conv of conversations) {
      const lm = conv.lastMessage;
      if (!lm?.messageId) continue;
      const hidden = hiddenByConv.get(conv.conversationId);
      if (!hidden?.has(lm.messageId)) continue;
      const resolved = await resolveLastVisibleLastMessageSnapshot(
        conv.conversationId,
        hidden,
        conversationRepository.getMessages,
      );
      if (resolved) conv.lastMessage = resolved;
      else delete conv.lastMessage;
    }

    /** Dữ liệu cũ có thể > giới hạn; giữ tối đa MAX theo hoạt động gần nhất, ghi DB và chỉnh bản trả về. */
    const pinnedRows = conversations.filter((c) => c.isPinnedToTop);
    if (pinnedRows.length > MAX_PINNED_CHATS_TO_TOP) {
      const sorted = [...pinnedRows].sort((a, b) => {
        const ta = a.lastMessageAt ?? a.updatedAt ?? '';
        const tb = b.lastMessageAt ?? b.updatedAt ?? '';
        if (tb !== ta) return tb.localeCompare(ta);
        return b.conversationId.localeCompare(a.conversationId);
      });
      const keepIds = new Set(
        sorted.slice(0, MAX_PINNED_CHATS_TO_TOP).map((c) => c.conversationId),
      );
      const toDemote = sorted.filter((c) => !keepIds.has(c.conversationId));
      await Promise.all(
        toDemote.map((c) =>
          conversationRepository.updateMemberPreferences(c.conversationId, userId, {
            isPinnedToTop: false,
          }),
        ),
      );
      for (const c of conversations) {
        if (c.isPinnedToTop && !keepIds.has(c.conversationId)) c.isPinnedToTop = false;
      }
    }

    const directConversations = conversations.filter(
      (conversation) => conversation.type === 'direct',
    );

    if (directConversations.length === 0) {
      return filterDisbandedGroupsFromList(conversations);
    }

    const membersPerConversation = await Promise.all(
      directConversations.map((conversation) =>
        conversationRepository.getConversationMembers(conversation.conversationId),
      ),
    );

    const otherUserIds = [
      ...new Set(
        membersPerConversation.flatMap((members) =>
          members.filter((member) => member.userId !== userId).map((member) => member.userId),
        ),
      ),
    ];

    const otherUsers = await userRepository.findByIds(otherUserIds);
    const userMap = new Map(otherUsers.map((user) => [user.userId, user]));

    directConversations.forEach((conversation, index) => {
      const otherMember = membersPerConversation[index].find((member) => member.userId !== userId);
      if (!otherMember) return;

      const otherUser = userMap.get(otherMember.userId);
      if (!otherUser) return;

      conversation.name = otherUser.displayName;
      conversation.avatar = otherUser.avatar ?? undefined;
      (conversation as IConversation & { otherUserId?: string }).otherUserId = otherMember.userId;
    });

    return filterDisbandedGroupsFromList(conversations);
  },

  /**
   * Tạo conversation mới (direct hoặc group).
   * Với direct: kiểm tra đã tồn tại conv 1-1 chưa, nếu có thì trả về conv cũ.
   */
  createConversation: async (
    creatorId: string,
    data: ICreateConversationDto,
  ): Promise<IConversation> => {
    const allMemberIds = Array.from(new Set([creatorId, ...data.memberIds]));

    // Với direct chat, tìm conv đã tồn tại
    if (data.type === 'direct' && allMemberIds.length === 2) {
      const otherId = allMemberIds.find((id) => id !== creatorId)!;
      const existing = await conversationRepository.findDirectConversation(creatorId, otherId);
      if (existing) return existing;
    }

    const now = new Date().toISOString();
    const conversationId = uuidv4();

    const initialGroupSettings = data.type === 'group' ? createInitialGroupSettings() : undefined;

    const conversation: IConversation = {
      conversationId,
      type: data.type,
      ...(data.name != null && data.name !== '' ? { name: data.name } : {}),
      ...(data.avatar != null && data.avatar.trim() !== '' ? { avatar: data.avatar.trim() } : {}),
      creatorId,
      ...(data.type === 'group' ? { leaderId: creatorId } : {}),
      ...(initialGroupSettings ? { groupSettings: initialGroupSettings } : {}),
      memberCount: allMemberIds.length,
      isEncrypted: false,
      createdAt: now,
      updatedAt: now,
    };

    await conversationRepository.createConversation(conversation);

    if (initialGroupSettings?.joinLinkSuffix) {
      await conversationRepository.upsertJoinLinkLookup(
        conversationId,
        initialGroupSettings.joinLinkSuffix,
      );
    }

    // Thêm tất cả thành viên
    await Promise.all(
      allMemberIds.map((userId, index) => {
        const member: IConversationMember = {
          conversationId,
          userId,
          role: index === 0 ? 'owner' : 'member',
          joinedAt: now,
          unreadCount: 0,
          isMuted: false,
          isPinnedToTop: false,
        };
        return conversationRepository.addConversationMember(member);
      }),
    );

    // Tạo system message thông báo tạo nhóm mới
    if (data.type === 'group') {
      let creatorName = 'Ai đó';
      try {
        const users = await userRepository.findByIds([creatorId]);
        creatorName = users[0]?.displayName || 'Ai đó';
      } catch {
        // ignore (best-effort)
      }

      try {
        await createAndBroadcastSystemMessage(
          {
            conversationId,
            senderId: creatorId,
            content: `${creatorName} đã tạo nhóm${data.name ? ` "${data.name}"` : ''}`,
          },
          {
            createMessage: conversationRepository.createMessage,
            updateConversationLastMessage: conversationRepository.updateConversationLastMessage,
          },
        );
      } catch {
        /* ignore system message errors */
      }
    }

    return conversation;
  },

  getConversationById: async (conversationId: string, userId: string): Promise<IConversation> => {
    const conversation = await conversationRepository.getConversationById(conversationId);
    if (!conversation) throw new NotFoundError('Hội thoại');

    // Kiểm tra user có phải thành viên không
    const members = await conversationRepository.getConversationMembers(conversationId);
    const me = members.find((m) => m.userId === userId);
    if (!me) throw new ForbiddenError('Bạn không phải thành viên của hội thoại này');

    return {
      ...conversation,
      unreadCount: me.unreadCount ?? 0,
      isMuted: isConversationNotificationPushMuted(me),
      isPinnedToTop: !!me.isPinnedToTop,
      notificationsMutedUntil: me.notificationsMutedUntil ?? undefined,
    };
  },

  getConversationMembers: async (
    conversationId: string,
    requesterUserId: string,
  ): Promise<{ userId: string; displayName?: string | null; email?: string | null }[]> => {
    const conversation = await conversationRepository.getConversationById(conversationId);
    if (!conversation) throw new NotFoundError('Hội thoại');

    const members = await conversationRepository.getConversationMembers(conversationId);
    const isMember = members.some((m) => m.userId === requesterUserId);
    if (!isMember) throw new ForbiddenError('Bạn không phải thành viên của hội thoại này');

    const memberIds = members.map((m) => m.userId);
    const profiles = await userRepository.findByIds(memberIds);
    const byId = new Map(profiles.map((u) => [u.userId, u]));

    return memberIds.map((userId) => {
      const u = byId.get(userId);
      return {
        userId,
        displayName: u?.displayName?.trim() ?? null,
        email: u?.email ?? null,
      };
    });
  },

  updateMyConversationPreferences: async (
    userId: string,
    conversationId: string,
    prefs: {
      isMuted?: boolean;
      isPinnedToTop?: boolean;
      notificationsMutedUntil?: string | null;
      muteFor?: '1m' | '5m' | '10m';
    },
  ): Promise<void> => {
    const { isMuted, isPinnedToTop, notificationsMutedUntil, muteFor } = prefs;
    if (
      isMuted === undefined &&
      isPinnedToTop === undefined &&
      notificationsMutedUntil === undefined &&
      muteFor == null
    ) {
      return;
    }

    const member = await conversationRepository.getMember(conversationId, userId);
    if (!member) throw new ForbiddenError('Bạn không phải thành viên của hội thoại này');

    if (isPinnedToTop === true) {
      const all = await conversationRepository.getConversations(userId);
      const alreadyTop = !!all.find((x) => x.conversationId === conversationId)?.isPinnedToTop;
      const totalTop = all.filter((x) => !!x.isPinnedToTop).length;
      if (!alreadyTop && totalTop >= MAX_PINNED_CHATS_TO_TOP) {
        throw new ForbiddenError(
          `Chỉ ghim được tối đa ${MAX_PINNED_CHATS_TO_TOP} hội thoại lên đầu danh sách.`,
        );
      }
    }

    const updates: {
      isMuted?: boolean;
      isPinnedToTop?: boolean;
      notificationsMutedUntil?: string | null;
    } = {};

    if (isPinnedToTop !== undefined) {
      updates.isPinnedToTop = isPinnedToTop;
    }

    if (isMuted === true) {
      updates.isMuted = true;
      updates.notificationsMutedUntil = null;
    } else if (isMuted === false) {
      updates.isMuted = false;
      updates.notificationsMutedUntil = null;
    }

    if (isMuted !== true) {
      if (muteFor === '1m') {
        updates.notificationsMutedUntil = new Date(Date.now() + 60_000).toISOString();
        if (isMuted === undefined) updates.isMuted = false;
      } else if (muteFor === '5m') {
        updates.notificationsMutedUntil = new Date(Date.now() + 5 * 60_000).toISOString();
        if (isMuted === undefined) updates.isMuted = false;
      } else if (muteFor === '10m') {
        updates.notificationsMutedUntil = new Date(Date.now() + 10 * 60_000).toISOString();
        if (isMuted === undefined) updates.isMuted = false;
      } else if (notificationsMutedUntil !== undefined) {
        updates.notificationsMutedUntil = notificationsMutedUntil;
        if (notificationsMutedUntil !== null && isMuted === undefined) {
          updates.isMuted = false;
        }
      }
    }

    if (Object.keys(updates).length === 0) return;

    await conversationRepository.updateMemberPreferences(conversationId, userId, updates);
  },

  updateGroupId: async (conversationId: string, groupId: string | null): Promise<void> => {
    await conversationRepository.updateGroupId(conversationId, groupId);
  },

  addMemberIfNotExist: async (
    conversationId: string,
    userId: string,
    role?: MemberRole,
  ): Promise<void> => {
    const existing = await conversationRepository.getMember(conversationId, userId);
    if (existing) return;

    const now = new Date().toISOString();
    await conversationRepository.addConversationMember({
      conversationId,
      userId,
      role: role || 'member',
      joinedAt: now,
      unreadCount: 0,
      isMuted: false,
      isPinnedToTop: false,
    });

    const members = await conversationRepository.getConversationMembers(conversationId);
    await conversationRepository.updateConversation(conversationId, {
      memberCount: members.length,
    });

    try {
      let userName = 'Ai đó';
      try {
        const users = await userRepository.findByIds([userId]);
        userName = users[0]?.displayName || 'Ai đó';
      } catch {
        // ignore
      }
      await createAndBroadcastSystemMessage(
        {
          conversationId,
          senderId: userId,
          content: `${userName} đã tham gia nhóm`,
        },
        {
          createMessage: conversationRepository.createMessage,
          updateConversationLastMessage: conversationRepository.updateConversationLastMessage,
        },
      );
    } catch {
      // ignore
    }
  },
};
