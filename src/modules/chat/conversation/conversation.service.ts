import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { env } from '@/config/env.js';
import {
  normalizeGroupConversationAvatarStored,
  extractMediaIdFromUrl,
  extractS3KeyFromUrl,
} from '@/modules/media/mediaUrl.util.js';
import { conversationRepository } from './conversation.repository.js';
import { messageUserHideRepository } from '../message/message-user-hide.repository.js';
import { mediaRepository } from '@/modules/media/media.repository.js';
import { getObjectStream } from '@/shared/services/s3Media.service.js';
import type { Readable } from 'node:stream';
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
import {
  emitConversationCreatedToUser,
  emitConversationDeletedForMe,
} from '../shared/chat.broadcast.js';
import {
  buildGroupCreatedContent,
  buildGroupMemberJoinedContent,
} from '../shared/group-system-message.js';
import { createInitialGroupSettings } from '../group/group.service.js';

/** Đẩy hội thoại mới vào sidebar của từng thành viên (web/mobile không cần reload). */
async function broadcastConversationCreatedToMembers(conversationId: string): Promise<void> {
  const cid = String(conversationId ?? '').trim();
  if (!cid) return;
  const members = await conversationRepository.getConversationMembers(cid);
  await Promise.all(
    members.map(async (m) => {
      try {
        const conv = await conversationService.getConversationById(cid, m.userId);
        await emitConversationCreatedToUser(m.userId, conv);
      } catch {
        /* best-effort */
      }
    }),
  );
}

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

      const clearedMs = conv.clearedAtMs ?? (conv.clearedAt ? Date.parse(conv.clearedAt) : 0);
      const lmTime = lm.createdAt ? Date.parse(lm.createdAt) : 0;

      const hidden = hiddenByConv.get(conv.conversationId);

      if (hidden?.has(lm.messageId)) {
        // Last message is hidden, find the next visible one
        const resolved = await resolveLastVisibleLastMessageSnapshot(
          conv.conversationId,
          hidden,
          conversationRepository.getMessages,
          conv.clearedUntilSK,
        );
        if (resolved) {
          const resolvedTime = resolved.createdAt ? Date.parse(resolved.createdAt) : 0;
          if (clearedMs > 0 && resolvedTime <= clearedMs) {
            delete conv.lastMessage;
          } else {
            conv.lastMessage = resolved;
          }
        } else {
          delete conv.lastMessage;
        }
      } else if (clearedMs > 0 && lmTime <= clearedMs) {
        // Last message is cleared/deleted
        delete conv.lastMessage;
      }
    }

    // Lọc các cuộc trò chuyện theo clearedAt
    const activeConversations = conversations.filter((c) => {
      if (c.clearedAt) {
        const clearedMs = c.clearedAtMs ?? Date.parse(c.clearedAt);
        const lastMsgAtMs = c.lastMessageAt ? Date.parse(c.lastMessageAt) : 0;
        const revealedMs = c.revealedAtMs ?? 0;

        const hasNewMessage = lastMsgAtMs > clearedMs;
        const wasRevealedAfterClear = revealedMs >= clearedMs;

        if (!hasNewMessage && !wasRevealedAfterClear) {
          return false;
        }
      }
      return true;
    });

    /** Dữ liệu cũ có thể > giới hạn; giữ tối đa MAX theo hoạt động gần nhất, ghi DB và chỉnh bản trả về. */
    const pinnedRows = activeConversations.filter((c) => c.isPinnedToTop);
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
      for (const c of activeConversations) {
        if (c.isPinnedToTop && !keepIds.has(c.conversationId)) c.isPinnedToTop = false;
      }
    }

    const directConversations = activeConversations.filter(
      (conversation) => conversation.type === 'direct',
    );

    if (directConversations.length === 0) {
      return filterDisbandedGroupsFromList(activeConversations);
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

    const filtered = filterDisbandedGroupsFromList(activeConversations);
    for (const c of filtered) {
      if (c.type === 'group') {
        c.avatar = normalizeGroupConversationAvatarStored(c.avatar, c.conversationId);
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
      if (existing) {
        // Tự động hiển thị lại cuộc hội thoại cho người bấm nhắn tin (creatorId)
        await conversationService.revealConversationForUser(existing.conversationId, creatorId);
        // Lấy lại thông tin hội thoại mới nhất sau khi reveal để trả về đầy đủ status (revealedAtMs, v.v.)
        const updated = await conversationService.getConversationById(
          existing.conversationId,
          creatorId,
        );
        // Đẩy hội thoại mới/unhide vào sidebar của creatorId qua socket realtime
        try {
          await emitConversationCreatedToUser(creatorId, updated);
        } catch {
          /* best-effort */
        }
        return updated;
      }
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
            content: buildGroupCreatedContent({ userId: creatorId, name: creatorName }),
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

    try {
      await broadcastConversationCreatedToMembers(conversationId);
    } catch {
      /* ignore socket errors */
    }

    const fresh = await conversationRepository.getConversationById(conversationId);
    if (fresh) {
      if (fresh.type === 'group') {
        fresh.avatar = normalizeGroupConversationAvatarStored(fresh.avatar, conversationId);
      }
      return fresh;
    }

    return conversation;
  },

  notifyConversationCreatedForUser: async (
    conversationId: string,
    userId: string,
  ): Promise<void> => {
    const cid = String(conversationId ?? '').trim();
    const uid = String(userId ?? '').trim();
    if (!cid || !uid) return;
    try {
      const conv = await conversationService.getConversationById(cid, uid);
      await emitConversationCreatedToUser(uid, conv);
    } catch {
      /* best-effort */
    }
  },

  getConversationById: async (conversationId: string, userId: string): Promise<IConversation> => {
    const conversation = await conversationRepository.getConversationById(conversationId);
    if (!conversation) throw new NotFoundError('Hội thoại');

    // Kiểm tra user có phải thành viên không
    const members = await conversationRepository.getConversationMembers(conversationId);
    const me = members.find((m) => m.userId === userId);
    if (!me) throw new ForbiddenError('Bạn không phải thành viên của hội thoại này');

    if (conversation.type === 'group') {
      conversation.avatar = normalizeGroupConversationAvatarStored(
        conversation.avatar,
        conversationId,
      );
    }

    const lm = conversation.lastMessage;
    if (lm?.messageId) {
      const hidden = await messageUserHideRepository.queryHiddenMessageIdsForConversation(
        userId,
        conversationId,
      );
      const clearedMs = me.clearedAtMs ?? (me.clearedAt ? Date.parse(me.clearedAt) : 0);
      const lmTime = lm.createdAt ? Date.parse(lm.createdAt) : 0;

      if (hidden.has(lm.messageId)) {
        const resolved = await resolveLastVisibleLastMessageSnapshot(
          conversationId,
          hidden,
          conversationRepository.getMessages,
          me.clearedUntilSK,
        );
        if (resolved) {
          const resolvedTime = resolved.createdAt ? Date.parse(resolved.createdAt) : 0;
          if (clearedMs > 0 && resolvedTime <= clearedMs) {
            delete conversation.lastMessage;
          } else {
            conversation.lastMessage = resolved;
          }
        } else {
          delete conversation.lastMessage;
        }
      } else if (clearedMs > 0 && lmTime <= clearedMs) {
        delete conversation.lastMessage;
      }
    }

    const lastMsgAtMs = conversation.lastMessageAt ? Date.parse(conversation.lastMessageAt) : 0;
    const listAtMs = Math.max(lastMsgAtMs, me.conversationListAtMs || 0);
    const listAt = listAtMs > 0 ? new Date(listAtMs).toISOString() : conversation.lastMessageAt;

    return {
      ...conversation,
      unreadCount: me.unreadCount ?? 0,
      isMuted: isConversationNotificationPushMuted(me),
      isPinnedToTop: !!me.isPinnedToTop,
      notificationsMutedUntil: me.notificationsMutedUntil ?? undefined,
      clearedAt: me.clearedAt,
      clearedAtMs: me.clearedAtMs,
      clearedUntilSK: me.clearedUntilSK,
      revealedAt: me.revealedAt,
      revealedAtMs: me.revealedAtMs,
      conversationListAt: listAt,
      conversationListAtMs: listAtMs,
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
          content: buildGroupMemberJoinedContent({ userId, name: userName }),
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

  getConversationAvatar: async (
    conversationId: string,
  ): Promise<{ buffer: Buffer; isFallback: boolean }> => {
    const conv = await conversationRepository.getConversationById(conversationId);
    if (!conv) throw new NotFoundError('Hội thoại');

    const members = await conversationRepository.getConversationMembers(conversationId);
    if (members.length === 0) {
      const buffer = await sharp({
        create: {
          width: 200,
          height: 200,
          channels: 4,
          background: { r: 220, g: 220, b: 220, alpha: 1 },
        },
      })
        .png()
        .toBuffer();
      return { buffer, isFallback: true };
    }

    // Sort members chronologically by joinedAt ascending, but ensure creator/leader is always first
    const sortedMembers = [...members].sort((a, b) => {
      const isCreatorA = a.userId === conv.creatorId || a.userId === conv.leaderId;
      const isCreatorB = b.userId === conv.creatorId || b.userId === conv.leaderId;
      if (isCreatorA && !isCreatorB) return -1;
      if (isCreatorB && !isCreatorA) return 1;

      const t1 = a.joinedAt || '';
      const t2 = b.joinedAt || '';
      const cmp = t1.localeCompare(t2);
      if (cmp !== 0) return cmp;

      return a.userId.localeCompare(b.userId);
    });

    const displayMembers = sortedMembers.slice(0, 4);
    const memberIds = displayMembers.map((m) => m.userId);
    const users = await userRepository.findByIds(memberIds);

    // Maintain chronological order of displayMembers
    const userMap = new Map(
      users.map((u) => {
        const resolvedId = u.userId || (u as any).PK?.replace('USER#', '') || '';
        return [resolvedId, u];
      }),
    );
    const displayUsers = displayMembers
      .map((m) => {
        const u = userMap.get(m.userId);
        if (u) {
          u.userId = u.userId || m.userId;
        }
        return u;
      })
      .filter((u): u is NonNullable<typeof u> => u !== undefined);

    const size = 200;
    const baseBg = sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 }, // White grid dividers
      },
    });

    const N = displayUsers.length;
    let getLayout: (index: number) => { width: number; height: number; x: number; y: number };

    if (N === 1) {
      getLayout = () => ({ width: 200, height: 200, x: 0, y: 0 });
    } else if (N === 2) {
      getLayout = (i) => {
        if (i === 0) return { width: 98, height: 200, x: 0, y: 0 };
        return { width: 98, height: 200, x: 102, y: 0 };
      };
    } else if (N === 3) {
      getLayout = (i) => {
        if (i === 0) return { width: 200, height: 98, x: 0, y: 0 };
        if (i === 1) return { width: 98, height: 98, x: 0, y: 102 };
        return { width: 98, height: 98, x: 102, y: 102 };
      };
    } else {
      getLayout = (i) => {
        if (i === 0) return { width: 98, height: 98, x: 0, y: 0 };
        if (i === 1) return { width: 98, height: 98, x: 102, y: 0 };
        if (i === 2) return { width: 98, height: 98, x: 0, y: 102 };
        return { width: 98, height: 98, x: 102, y: 102 };
      };
    }

    const compositePromises = displayUsers.map(async (u, i) => {
      const name = u.displayName || 'User';
      const layout = getLayout(i);
      let avatarBuf: Buffer;

      if (u.avatar) {
        try {
          const avatarUrl = u.avatar.trim();
          const s3Key = extractS3KeyFromUrl(avatarUrl);
          if (s3Key) {
            const { stream } = await getObjectStream(s3Key);
            avatarBuf = await streamToBuffer(stream);
          } else {
            const mediaId = extractMediaIdFromUrl(avatarUrl);
            if (mediaId) {
              const media = await mediaRepository.findById(mediaId);
              if (media?.s3Key) {
                const { stream } = await getObjectStream(media.s3Key);
                avatarBuf = await streamToBuffer(stream);
              } else {
                throw new Error('Local media s3Key missing');
              }
            } else {
              let externalUrl = avatarUrl;
              if (externalUrl.startsWith('/')) {
                externalUrl = `${env.API_PUBLIC_ORIGIN}${externalUrl}`;
              }
              const res = await fetch(externalUrl, { signal: AbortSignal.timeout(1500) });
              if (res.ok) {
                const arrayBuf = await res.arrayBuffer();
                avatarBuf = Buffer.from(arrayBuf);
              } else {
                throw new Error('Fetch failed');
              }
            }
          }
        } catch {
          avatarBuf = generateSvgAvatar(name, layout.width, layout.height);
        }
      } else {
        avatarBuf = generateSvgAvatar(name, layout.width, layout.height);
      }

      // Resize and crop to fill the layout cell exactly
      const partBuf = await sharp(avatarBuf)
        .resize(layout.width, layout.height, {
          fit: 'cover',
          position: 'center',
        })
        .png()
        .toBuffer();

      return {
        input: partBuf,
        top: layout.y,
        left: layout.x,
      };
    });

    const composites = await Promise.all(compositePromises);

    const buffer = await baseBg.composite(composites).png().toBuffer();
    return { buffer, isFallback: N < 2 };
  },

  clearConversationHistoryForUser: async (
    userId: string,
    conversationId: string,
  ): Promise<{
    conversationId: string;
    type: string;
    clearedAt: string;
    clearedAtMs: number;
    hiddenFromList: boolean;
  }> => {
    const conversation = await conversationRepository.getConversationById(conversationId);
    if (!conversation) throw new NotFoundError('Hội thoại');

    const member = await conversationRepository.getMember(conversationId, userId);
    if (!member) throw new ForbiddenError('Bạn không phải thành viên của hội thoại này');

    // Lấy tin nhắn mới nhất trong cuộc trò chuyện (giới hạn 1 tin) để xác định clearedUntilSK
    const recentMessages = await conversationRepository.listRecentMessages(conversationId, {
      limit: 1,
    });
    const latestMessage = recentMessages[0] || null;

    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const clearedUntilSK = latestMessage?.SK ?? null;

    await conversationRepository.updateMemberPreferences(conversationId, userId, {
      clearedAt: nowIso,
      clearedAtMs: nowMs,
      clearedUntilSK,
    });

    // Cập nhật lastReadAt để reset unreadCount
    await conversationRepository.resetMemberUnreadCount(conversationId, userId);

    const shouldHideFromList = true;

    await emitConversationDeletedForMe(userId, {
      conversationId,
      type: conversation.type,
      clearedAt: nowIso,
      clearedAtMs: nowMs,
      shouldHideFromList,
    });

    return {
      conversationId,
      type: conversation.type,
      clearedAt: nowIso,
      clearedAtMs: nowMs,
      hiddenFromList: shouldHideFromList,
    };
  },

  revealConversationForUser: async (conversationId: string, userId: string): Promise<void> => {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    await conversationRepository.revealConversationForUser(conversationId, userId, nowIso, nowMs);
  },
};

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}
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

function generateSvgAvatar(name: string, width: number, height: number): Buffer {
  const initials = getInitials(name);
  const color = getRandomColor(name);
  const minDim = Math.min(width, height);
  const svg = `
    <svg width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="${color}" />
      <text x="50%" y="50%" text-anchor="middle" dy=".35em" fill="white" font-family="Arial" font-size="${Math.floor(minDim / 2.2)}px" font-weight="bold">${initials}</text>
    </svg>
  `;
  return Buffer.from(svg);
}
