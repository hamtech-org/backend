import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { env } from '@/config/env.js';
import { conversationRepository } from './conversation.repository.js';
import { messageUserHideRepository } from '../message/message-user-hide.repository.js';
import type {
  IConversation,
  IConversationMember,
  ICreateConversationDto,
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

    const filtered = filterDisbandedGroupsFromList(conversations);
    for (const c of filtered) {
      if (c.type === 'group' && (!c.avatar || !c.avatar.trim())) {
        c.avatar = `/api/v1/chat/conversations/${c.conversationId}/avatar`;
      }
    }
    return filtered;
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
      if (await userRepository.hasBlockBetween(creatorId, otherId)) {
        throw new ForbiddenError('Khong the tao hoi thoai vi mot trong hai ben da chan nhau');
      }
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
      avatar:
        data.avatar != null && data.avatar.trim() !== ''
          ? data.avatar.trim()
          : data.type === 'group'
            ? `/api/v1/chat/conversations/${conversationId}/avatar`
            : undefined,
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

    if (conversation.type === 'group' && (!conversation.avatar || !conversation.avatar.trim())) {
      conversation.avatar = `/api/v1/chat/conversations/${conversationId}/avatar`;
    }

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

  getConversationAvatar: async (conversationId: string): Promise<Buffer> => {
    const conv = await conversationRepository.getConversationById(conversationId);
    if (!conv) throw new NotFoundError('Hội thoại');

    const members = await conversationRepository.getConversationMembers(conversationId);
    if (members.length === 0) {
      return sharp({
        create: {
          width: 200,
          height: 200,
          channels: 4,
          background: { r: 220, g: 220, b: 220, alpha: 1 },
        },
      })
        .png()
        .toBuffer();
    }

    const memberIds = members.map((m) => m.userId);
    const users = await userRepository.findByIds(memberIds);
    const displayUsers = users.slice(0, 4);

    const size = 200;
    const baseBg = sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 240, g: 240, b: 240, alpha: 1 },
      },
    });

    const composites: any[] = [];
    const N = displayUsers.length;
    let getLayout: (index: number) => { size: number; x: number; y: number };

    if (N === 1) {
      getLayout = () => ({ size: 120, x: 40, y: 40 });
    } else if (N === 2) {
      getLayout = (i) => {
        if (i === 0) return { size: 110, x: 10, y: 10 };
        return { size: 110, x: 80, y: 80 };
      };
    } else if (N === 3) {
      getLayout = (i) => {
        if (i === 0) return { size: 95, x: 52, y: 10 };
        if (i === 1) return { size: 95, x: 10, y: 95 };
        return { size: 95, x: 95, y: 95 };
      };
    } else {
      getLayout = (i) => {
        if (i === 0) return { size: 85, x: 10, y: 10 };
        if (i === 1) return { size: 85, x: 105, y: 10 };
        if (i === 2) return { size: 85, x: 10, y: 105 };
        return { size: 85, x: 105, y: 105 };
      };
    }

    for (let i = 0; i < N; i++) {
      const u = displayUsers[i];
      const name = u.displayName || 'User';
      const layout = getLayout(i);
      let avatarBuf: Buffer;

      if (u.avatar) {
        try {
          let avatarUrl = u.avatar.trim();
          if (avatarUrl.startsWith('/')) {
            avatarUrl = `${env.API_PUBLIC_ORIGIN}${avatarUrl}`;
          }
          const res = await fetch(avatarUrl);
          if (res.ok) {
            const arrayBuf = await res.arrayBuffer();
            avatarBuf = Buffer.from(arrayBuf);
          } else {
            throw new Error('Fetch failed');
          }
        } catch {
          avatarBuf = generateSvgAvatar(name, layout.size);
        }
      } else {
        avatarBuf = generateSvgAvatar(name, layout.size);
      }

      const circleMask = Buffer.from(
        `<svg width="${layout.size}" height="${layout.size}"><circle cx="${layout.size / 2}" cy="${layout.size / 2}" r="${layout.size / 2}" fill="white"/></svg>`,
      );
      const circularBuf = await sharp(avatarBuf)
        .resize(layout.size, layout.size)
        .composite([{ input: circleMask, blend: 'dest-in' }])
        .png()
        .toBuffer();

      composites.push({
        input: circularBuf,
        top: layout.y,
        left: layout.x,
      });
    }

    return baseBg.composite(composites).png().toBuffer();
  },
};

function getRandomColor(name: string): string {
  const colors = [
    '#f44336',
    '#e91e63',
    '#9c27b0',
    '#673ab7',
    '#3f51b5',
    '#2196f3',
    '#009688',
    '#4caf50',
    '#ff9800',
    '#ff5722',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 0 || !words[0]) return '?';
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
}

function generateSvgAvatar(name: string, size: number): Buffer {
  const initials = getInitials(name);
  const color = getRandomColor(name);
  const svg = `
    <svg width="${size}" height="${size}">
      <rect width="100%" height="100%" fill="${color}" />
      <text x="50%" y="55%" text-anchor="middle" dy=".3em" fill="white" font-family="Arial" font-size="${Math.floor(size / 2.2)}px" font-weight="bold">${initials}</text>
    </svg>
  `;
  return Buffer.from(svg);
}
