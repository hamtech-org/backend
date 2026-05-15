import { conversationRepository } from '../conversation/conversation.repository.js';
import { memberRequestRepository } from '../member-request/member-request.repository.js';
import { randomBytes } from 'node:crypto';
import type {
  IConversationMember,
  IUpdateGroupDto,
  IAddMembersDto,
  IGroupSettings,
} from '../shared/chat.types.js';
import { NotFoundError, ForbiddenError, ValidationError } from '@/shared/utils/errors.js';
import { userRepository } from '@/modules/user/user.repository.js';
import { createAndBroadcastSystemMessage } from '../shared/system-message.factory.js';
import { resolveChatMemberLabel } from '../shared/chat.helpers.js';
import {
  buildGroupMemberInvitedContent,
  buildGroupMemberRemovedContent,
  type GroupSystemPerson,
} from '../shared/group-system-message.js';
import type { MemberRole } from '@/shared/types/chat.types.js';
import { MIN_GROUP_MEMBERS } from './group.constants.js';

const sysMsgDeps = {
  createMessage: conversationRepository.createMessage,
  updateConversationLastMessage: conversationRepository.updateConversationLastMessage,
};

const DEFAULT_MEMBER_PERMS: IGroupSettings['memberPermissions'] = {
  changeNameAvatar: true,
  pinMessages: true,
  createNotesReminders: true,
  createPolls: true,
  sendMessages: true,
};

const DEFAULT_ADMIN: IGroupSettings['adminSettings'] = {
  approvalRequired: false,
  highlightLeaderMessages: true,
  newMembersReadRecent: true,
  allowJoinLink: true,
};

export function mergeGroupSettings(raw: Partial<IGroupSettings> | undefined | null): IGroupSettings {
  return {
    memberPermissions: { ...DEFAULT_MEMBER_PERMS, ...raw?.memberPermissions },
    adminSettings: { ...DEFAULT_ADMIN, ...raw?.adminSettings },
    joinLinkSuffix: raw?.joinLinkSuffix,
  };
}

/** Trạng thái yêu cầu khi mời / xin vào nhóm. */
type MemberPermKey = keyof IGroupSettings['memberPermissions'];

const MEMBER_PERM_MESSAGES: Record<MemberPermKey, string> = {
  changeNameAvatar:
    'Nhóm không cho phép thành viên đổi tên hoặc ảnh đại diện. Chỉ trưởng nhóm có thể chỉnh sửa',
  pinMessages: 'Nhóm không cho phép thành viên ghim tin nhắn',
  createNotesReminders: 'Nhóm không cho phép thành viên tạo công việc / nhắc hẹn',
  createPolls: 'Nhóm không cho phép thành viên tạo bình chọn',
  sendMessages: 'Nhóm không cho phép thành viên gửi tin nhắn',
};

function normalizeMemberRole(
  role: unknown,
  userId: string,
  conversationCreatorId?: string | null,
): MemberRole | null {
  const r = String(role ?? '')
    .trim()
    .toLowerCase();
  if (r === 'owner' || r === 'admin' || r === 'member') return r;
  if (conversationCreatorId && String(conversationCreatorId).trim() === userId) return 'owner';
  return null;
}

/** owner/admin bỏ qua; member phải có quyền trong groupSettings. */
async function assertMemberGroupPermission(
  userId: string,
  conversationId: string,
  permission: MemberPermKey,
): Promise<void> {
  const c = await conversationRepository.getConversationById(conversationId);
  if (!c) throw new NotFoundError('Hội thoại');
  if (c.type !== 'group') return;
  const member = await conversationRepository.getMember(conversationId, userId);
  if (!member) throw new ForbiddenError('Bạn không phải thành viên nhóm');

  let role = normalizeMemberRole(member.role, userId, c.creatorId);
  if (!role) {
    const members = await conversationRepository.getConversationMembers(conversationId);
    const fromList = members.find((m) => String(m.userId ?? '').trim() === userId);
    role = normalizeMemberRole(fromList?.role, userId, c.creatorId);
  }
  const mayBypass =
    permission === 'changeNameAvatar' ? role === 'owner' : role === 'owner' || role === 'admin';
  if (mayBypass) return;

  const s = mergeGroupSettings(c.groupSettings);
  if (!s.memberPermissions[permission]) {
    throw new ForbiddenError(MEMBER_PERM_MESSAGES[permission]);
  }
}

export async function resolveGroupRequestStatus(
  conversationId: string,
  userId: string,
  groupSettings?: Partial<IGroupSettings> | null,
): Promise<'pending' | 'invited'> {
  const wasKicked = await memberRequestRepository.isKickedMember(conversationId, userId);
  if (wasKicked) return 'pending';
  let settings = groupSettings;
  if (settings === undefined) {
    const c = await conversationRepository.getConversationById(conversationId);
    settings = c?.groupSettings;
  }
  const merged = mergeGroupSettings(settings);
  if (merged.adminSettings.approvalRequired) return 'pending';
  return 'invited';
}

export type UpdateGroupSettingsPayload = {
  memberPermissions?: Partial<IGroupSettings['memberPermissions']>;
  adminSettings?: Partial<IGroupSettings['adminSettings']>;
  regenerateJoinLink?: boolean;
};

export const groupService = {
  /**
   * Lấy danh sách thành viên nhóm (group)
   */
  getGroupMembers: async (groupId: string): Promise<IConversationMember[]> => {
    const members = (
      await conversationRepository.getConversationMembers(groupId)
    ).filter((m) => Boolean(String(m.userId ?? '').trim()));
    if (members.length === 0) return members;

    // Enrich để FE hiển thị avatar/name đồng bộ (không phá compatibility: vẫn giữ fields gốc).
    try {
      const userIds = members.map((m) => m.userId);
      const users = await userRepository.findByIds(userIds);
      const byId = new Map(users.map((u) => [u.userId, u]));
      return members.map((m) => {
        const u = byId.get(m.userId);
        return {
          ...m,
          name: u?.displayName ?? u?.email ?? m.userId,
          avatar: u?.avatar ?? null,
        } as any;
      });
    } catch {
      return members;
    }
  },

  updateGroup: async (
    requesterId: string,
    conversationId: string,
    data: IUpdateGroupDto,
  ): Promise<any> => {
    const conversation = await conversationRepository.getConversationById(conversationId);
    if (!conversation) throw new NotFoundError('Nhóm');
    if (conversation.type !== 'group') throw new ForbiddenError('Đây không phải nhóm chat');

    const member = await conversationRepository.getMember(conversationId, requesterId);
    if (!member) {
      throw new ForbiddenError('Bạn không phải thành viên của nhóm này');
    }

    if (data.name !== undefined || data.avatar !== undefined) {
      await assertMemberGroupPermission(requesterId, conversationId, 'changeNameAvatar');
    }

    const oldName = conversation.name || '';
    const oldAvatar = conversation.avatar || '';

    await conversationRepository.updateConversation(conversationId, data);
    const updatedConversation = { ...conversation, ...data, updatedAt: new Date().toISOString() };

    // If group name changed, create and broadcast a system message
    if (data.name && data.name !== oldName) {
      let userName = '';
      try {
        const users = await userRepository.findByIds([requesterId]);
        userName = users[0]?.displayName || 'Ai đó';
      } catch {
        userName = 'Ai đó';
      }
      try {
        await createAndBroadcastSystemMessage(
          { conversationId, senderId: requesterId, content: `${userName} đổi tên nhóm thành '${data.name}'` },
          sysMsgDeps,
        );
      } catch { /* ignore */ }
    }

    // If group avatar changed, create and broadcast a system message
    if (data.avatar && data.avatar !== oldAvatar) {
      let userName = '';
      try {
        const users = await userRepository.findByIds([requesterId]);
        userName = users[0]?.displayName || 'Ai đó';
      } catch {
        userName = 'Ai đó';
      }
      try {
        await createAndBroadcastSystemMessage(
          { conversationId, senderId: requesterId, content: `${userName} đã cập nhật ảnh đại diện nhóm`, mediaUrl: data.avatar, mediaType: 'image' },
          sysMsgDeps,
        );
      } catch { /* ignore */ }
    }

    return updatedConversation;
  },

  deleteGroup: async (requesterId: string, conversationId: string): Promise<void> => {
    const conversation = await conversationRepository.getConversationById(conversationId);
    if (!conversation) throw new NotFoundError('Nhóm');
    if (conversation.type !== 'group') throw new ForbiddenError('Đây không phải nhóm chat');
    const requesterMember = await conversationRepository.getMember(conversationId, requesterId);
    if (!requesterMember) throw new ForbiddenError('Bạn không phải thành viên nhóm');
    const disbandRole = normalizeMemberRole(
      requesterMember.role,
      requesterId,
      conversation.creatorId,
    );
    if (disbandRole !== 'owner') {
      throw new ForbiddenError('Chỉ trưởng nhóm mới có quyền giải tán nhóm');
    }

    const members = await conversationRepository.getConversationMembers(conversationId);

    try {
      await createAndBroadcastSystemMessage(
        {
          conversationId,
          senderId: requesterId,
          content: 'Nhóm đã được giải tán',
        },
        sysMsgDeps,
      );
    } catch {
      /* vẫn giải tán nếu tin hệ thống lỗi */
    }

    await conversationRepository.updateConversation(conversationId, {
      name: `[ĐÃ GIẢI TÁN] ${conversation.name ?? 'Nhóm'}`,
      isDeleted: true,
      memberCount: 0,
    } as any);

    await Promise.all(members.map((m) => conversationRepository.removeMember(conversationId, m.userId)));
  },

  leaveGroup: async (
    userId: string,
    conversationId: string,
    options?: { newOwnerUserId?: string },
  ): Promise<{ memberCount: number }> => {
    const member = await conversationRepository.getMember(conversationId, userId);
    if (!member) throw new NotFoundError('Thành viên nhóm');

    const conv = await conversationRepository.getConversationById(conversationId);
    if (!conv || conv.type !== 'group') throw new NotFoundError('Nhóm');

    const allMembers = await conversationRepository.getConversationMembers(conversationId);
    const currentCount = allMembers.length;
    const afterLeave = currentCount - 1;
    if (afterLeave < MIN_GROUP_MEMBERS) {
      throw new ValidationError(
        `Nhóm cần tối thiểu ${MIN_GROUP_MEMBERS} thành viên. Hiện có ${currentCount} người — không thể rời nhóm (mời thêm thành viên hoặc dùng giải tán nhóm).`,
      );
    }

    if (member.role !== 'owner') {
      let leaverName = 'Ai đó';
      try {
        const users = await userRepository.findByIds([userId]);
        leaverName = users[0]?.displayName?.trim() || leaverName;
      } catch {
        /* ignore */
      }
      try {
        await createAndBroadcastSystemMessage(
          {
            conversationId,
            senderId: userId,
            content: `${leaverName} đã rời nhóm`,
          },
          sysMsgDeps,
        );
      } catch {
        /* vẫn cho rời nếu tin hệ thống lỗi */
      }

      await conversationRepository.removeMember(conversationId, userId);
      await conversationRepository.updateConversation(conversationId, {
        memberCount: Math.max(0, afterLeave),
      });
      return { memberCount: Math.max(0, afterLeave) };
    }

    const others = allMembers.filter((m) => m.userId !== userId);
    if (others.length === 0) {
      throw new ForbiddenError(
        'Bạn là thành viên duy nhất trong nhóm. Hãy giải tán nhóm thay vì rời nhóm.',
      );
    }

    const newOwnerId = options?.newOwnerUserId?.trim();
    if (!newOwnerId) {
      throw new ValidationError('Trưởng nhóm cần chọn thành viên nhận quyền trưởng nhóm trước khi rời nhóm.');
    }
    const successor = allMembers.find((m) => m.userId === newOwnerId);
    if (!successor || successor.userId === userId) {
      throw new ValidationError('Thành viên được chọn không hợp lệ hoặc không thuộc nhóm.');
    }

    const newMemberCount = Math.max(0, afterLeave);

    await conversationRepository.updateMemberRole(conversationId, successor.userId, 'owner');
    await conversationRepository.updateConversation(conversationId, {
      creatorId: successor.userId,
      memberCount: newMemberCount,
    });
    await conversationRepository.removeMember(conversationId, userId);

    try {
      let leaverName = 'Ai đó';
      let successorName = successor.userId;
      try {
        const users = await userRepository.findByIds([userId, successor.userId]);
        const byId = new Map(users.map((u) => [u.userId, u]));
        leaverName = byId.get(userId)?.displayName ?? leaverName;
        successorName = byId.get(successor.userId)?.displayName ?? successorName;
      } catch {
        /* ignore */
      }

      await createAndBroadcastSystemMessage(
        {
          conversationId,
          senderId: userId,
          content: `${leaverName} đã rời nhóm. ${successorName} là trưởng nhóm mới.`,
        },
        sysMsgDeps,
      );
    } catch {
      /* ignore system message errors */
    }

    return { memberCount: newMemberCount };
  },

  addMembers: async (
    requesterId: string,
    conversationId: string,
    data: IAddMembersDto,
  ): Promise<void> => {
    const member = await conversationRepository.getMember(conversationId, requesterId);
    if (!member || !['owner', 'admin', 'member'].includes(member.role)) {
      throw new ForbiddenError('Bạn không có quyền thêm thành viên');
    }

    const memberIdsToInvite: string[] = [];
    for (const userId of data.memberIds) {
      const existingMember = await conversationRepository.getMember(conversationId, userId);
      if (existingMember) {
        await conversationRepository.removeAllMemberRecordsForUser(conversationId, userId);
        memberIdsToInvite.push(userId);
        continue;
      }
      const orphanRows = await conversationRepository.removeAllMemberRecordsForUser(
        conversationId,
        userId,
      );
      if (orphanRows > 0) {
        memberIdsToInvite.push(userId);
        continue;
      }
      memberIdsToInvite.push(userId);
    }
    if (memberIdsToInvite.length === 0) return;

    const convMeta = await conversationRepository.getConversationById(conversationId);
    const mergedSettings = mergeGroupSettings(convMeta?.groupSettings);

    await Promise.all(
      memberIdsToInvite.map(async (userId) => {
        const status = await resolveGroupRequestStatus(conversationId, userId, mergedSettings);
        await memberRequestRepository.createGroupRequest(
          conversationId,
          userId,
          status,
          requesterId,
        );
      }),
    );

    // Tin «đã mời» gửi khi duyệt (2 pill: mời + tham gia). Bỏ qua lúc chờ duyệt để tránh trùng.
    if (!mergedSettings.adminSettings.approvalRequired) {
      try {
        let actorName = resolveChatMemberLabel(requesterId, null);
        const targets: GroupSystemPerson[] = [];
        try {
          const users = await userRepository.findByIds([requesterId, ...memberIdsToInvite]);
          const byId = new Map(users.map((u) => [u.userId, u]));
          actorName = resolveChatMemberLabel(requesterId, byId.get(requesterId) ?? null);
          for (const id of memberIdsToInvite) {
            targets.push({
              userId: id,
              name: resolveChatMemberLabel(id, byId.get(id) ?? null),
            });
          }
        } catch {
          for (const id of memberIdsToInvite) {
            targets.push({ userId: id, name: resolveChatMemberLabel(id, null) });
          }
        }

        await createAndBroadcastSystemMessage(
          {
            conversationId,
            senderId: requesterId,
            content: buildGroupMemberInvitedContent(
              { userId: requesterId, name: actorName },
              targets,
            ),
          },
          sysMsgDeps,
        );
      } catch {
        /* ignore system message errors */
      }
    }
  },

  removeMember: async (
    requesterId: string,
    conversationId: string,
    targetUserId: string,
  ): Promise<{ memberCount: number }> => {
    const requester = await conversationRepository.getMember(conversationId, requesterId);
    if (!requester || !['owner', 'admin'].includes(requester.role)) {
      throw new ForbiddenError('Chỉ Admin/Owner mới có quyền xóa thành viên');
    }

    const allMembers = await conversationRepository.getConversationMembers(conversationId);
    if (allMembers.length <= MIN_GROUP_MEMBERS) {
      throw new ValidationError(
        `Nhóm cần tối thiểu ${MIN_GROUP_MEMBERS} thành viên — không thể mời thành viên ra khi nhóm chỉ còn ${allMembers.length} người.`,
      );
    }

    const trimmedTarget = targetUserId.trim();
    const resolved = await conversationRepository.resolveMemberForRemoval(
      conversationId,
      trimmedTarget,
    );

    if (resolved?.member.role === 'owner') {
      throw new ForbiddenError('Không thể xóa chủ nhóm');
    }

    const removedMemberRows = await conversationRepository.removeAllMemberRecordsForUser(
      conversationId,
      resolved?.deleteUserId ?? trimmedTarget,
    );

    if (!resolved && removedMemberRows === 0) {
      await memberRequestRepository.removeGroupRequest(conversationId, trimmedTarget);
      await memberRequestRepository.recordKickedMember(conversationId, trimmedTarget);
      const membersAfter = await conversationRepository.getConversationMembers(conversationId);
      const memberCount = membersAfter.length;
      await conversationRepository.updateConversation(conversationId, { memberCount });
      try {
        let requesterName = resolveChatMemberLabel(requesterId, null);
        let targetName = resolveChatMemberLabel(trimmedTarget, null);
        try {
          const users = await userRepository.findByIds([requesterId, trimmedTarget]);
          const byId = new Map(users.map((u) => [u.userId, u]));
          requesterName = resolveChatMemberLabel(requesterId, byId.get(requesterId) ?? null);
          targetName = resolveChatMemberLabel(trimmedTarget, byId.get(trimmedTarget) ?? null);
        } catch {
          /* ignore */
        }
        await createAndBroadcastSystemMessage(
          {
            conversationId,
            senderId: requesterId,
            content: buildGroupMemberRemovedContent(
              { userId: requesterId, name: requesterName },
              { userId: trimmedTarget, name: targetName },
            ),
          },
          sysMsgDeps,
        );
      } catch {
        /* ignore */
      }
      return { memberCount };
    }

    const deleteUserId = resolved?.deleteUserId ?? trimmedTarget;
    const target = resolved?.member;

    await memberRequestRepository.removeGroupRequest(conversationId, deleteUserId);
    await memberRequestRepository.recordKickedMember(conversationId, deleteUserId);

    const membersAfter = await conversationRepository.getConversationMembers(conversationId);
    const memberCount = membersAfter.length;
    await conversationRepository.updateConversation(conversationId, {
      memberCount,
    });

    try {
      const targetWithName = (target ?? { userId: deleteUserId }) as IConversationMember & {
        name?: string | null;
      };
      let requesterName = resolveChatMemberLabel(requesterId, null);
      let targetName = resolveChatMemberLabel(deleteUserId, targetWithName);
      try {
        const users = await userRepository.findByIds([requesterId, deleteUserId]);
        const byId = new Map(users.map((u) => [u.userId, u]));
        requesterName = resolveChatMemberLabel(requesterId, byId.get(requesterId) ?? null);
        targetName = resolveChatMemberLabel(
          deleteUserId,
          byId.get(deleteUserId) ?? targetWithName,
        );
      } catch {
        /* ignore */
      }

      await createAndBroadcastSystemMessage(
        {
          conversationId,
          senderId: requesterId,
          content: buildGroupMemberRemovedContent(
            { userId: requesterId, name: requesterName },
            { userId: deleteUserId, name: targetName },
          ),
        },
        sysMsgDeps,
      );
    } catch {
      /* ignore system message errors */
    }

    return { memberCount };
  },

  changeMemberRole: async (
    requesterId: string,
    conversationId: string,
    targetUserId: string,
    role: MemberRole,
  ): Promise<void> => {
    const requester = await conversationRepository.getMember(conversationId, requesterId);
    if (!requester || requester.role !== 'owner') {
      throw new ForbiddenError('Chỉ Owner mới có quyền thay đổi vai trò Admin');
    }

    await conversationRepository.updateMemberRole(conversationId, targetUserId, role);
  },

  getGroupSettings: async (conversationId: string): Promise<IGroupSettings> => {
    const c = await conversationRepository.getConversationById(conversationId);
    if (!c) throw new NotFoundError('Hội thoại');
    if (c.type !== 'group') throw new ForbiddenError('Đây không phải nhóm chat');
    return mergeGroupSettings(c.groupSettings);
  },

  updateGroupSettings: async (
    requesterId: string,
    conversationId: string,
    patch: UpdateGroupSettingsPayload,
  ): Promise<IGroupSettings> => {
    const member = await conversationRepository.getMember(conversationId, requesterId);
    if (!member) throw new ForbiddenError('Bạn không phải thành viên nhóm');
    const c = await conversationRepository.getConversationById(conversationId);
    if (!c) throw new NotFoundError('Hội thoại');
    const settingsRole = normalizeMemberRole(member.role, requesterId, c.creatorId);
    if (settingsRole !== 'owner') {
      throw new ForbiddenError('Chỉ trưởng nhóm mới chỉnh được cài đặt');
    }
    if (c.type !== 'group') throw new ForbiddenError('Đây không phải nhóm chat');

    const current = mergeGroupSettings(c.groupSettings);
    let joinLinkSuffix = current.joinLinkSuffix;
    if (patch.regenerateJoinLink) {
      joinLinkSuffix = randomBytes(6).toString('hex');
    }
    const next: IGroupSettings = {
      memberPermissions: { ...current.memberPermissions, ...patch.memberPermissions },
      adminSettings: { ...current.adminSettings, ...patch.adminSettings },
      joinLinkSuffix,
    };

    await conversationRepository.updateConversation(conversationId, {
      groupSettings: next,
    } as any);
    return next;
  },

  /**
   * Kiểm tra thành viên có được ghim/bỏ ghim trong nhóm (theo groupSettings + role).
   */
  assertUserMayPinMessage: async (userId: string, conversationId: string): Promise<void> => {
    await assertMemberGroupPermission(userId, conversationId, 'pinMessages');
  },

  assertUserMaySendMessage: async (userId: string, conversationId: string): Promise<void> => {
    await assertMemberGroupPermission(userId, conversationId, 'sendMessages');
  },

  assertUserMayCreatePoll: async (userId: string, conversationId: string): Promise<void> => {
    await assertMemberGroupPermission(userId, conversationId, 'createPolls');
  },

  assertUserMayCreateTask: async (userId: string, conversationId: string): Promise<void> => {
    await assertMemberGroupPermission(userId, conversationId, 'createNotesReminders');
  },
};
