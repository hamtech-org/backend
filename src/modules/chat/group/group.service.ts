import { conversationRepository } from '../conversation/conversation.repository.js';
import { memberRequestRepository } from '../member-request/member-request.repository.js';
import { randomBytes, randomUUID } from 'node:crypto';
import type {
  IConversation,
  IConversationMember,
  IUpdateGroupDto,
  IAddMembersDto,
  IGroupSettings,
  IGroupRoleAuditLog,
} from '../shared/chat.types.js';
import { NotFoundError, ForbiddenError, ValidationError } from '@/shared/utils/errors.js';
import { userRepository } from '@/modules/user/user.repository.js';
import { createAndBroadcastSystemMessage } from '../shared/system-message.factory.js';
import { resolveChatMemberLabel } from '../shared/chat.helpers.js';
import {
  buildGroupMemberInvitedContent,
  buildGroupMemberLeftContent,
  buildGroupMemberRemovedContent,
  buildGroupOwnerAssignedContent,
  buildGroupOwnerTransferredContent,
  buildGroupAdminPromotedContent,
  buildGroupAdminDemotedContent,
  type GroupSystemPerson,
} from '../shared/group-system-message.js';
import type { MemberRole } from '@/shared/types/chat.types.js';
import { MAX_GROUP_ADMINS, MIN_GROUP_MEMBERS } from './group.constants.js';

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

export function mergeGroupSettings(
  raw: Partial<IGroupSettings> | undefined | null,
): IGroupSettings {
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
  conversationLeaderId?: string | null,
  conversationCreatorId?: string | null,
): MemberRole | null {
  const r = String(role ?? '')
    .trim()
    .toLowerCase();
  if (r === 'owner' || r === 'admin' || r === 'member') return r;
  const leaderId = String(conversationLeaderId ?? '').trim();
  if (leaderId && leaderId === userId) return 'owner';
  if (!leaderId && conversationCreatorId && String(conversationCreatorId).trim() === userId) {
    return 'owner';
  }
  return null;
}

function resolveMemberRole(
  member: Pick<IConversationMember, 'role' | 'userId'> | null | undefined,
  conversation: Pick<IConversation, 'leaderId' | 'creatorId'>,
): MemberRole | null {
  if (!member) return null;
  return normalizeMemberRole(
    member.role,
    member.userId,
    conversation.leaderId,
    conversation.creatorId,
  );
}

const GROUP_ADMIN_LIMIT_MESSAGE = `Nhóm chỉ có tối đa ${MAX_GROUP_ADMINS} phó nhóm. Hãy hạ một phó nhóm trước khi bổ nhiệm thêm.`;

function countGroupAdmins(
  members: IConversationMember[],
  conversation: Pick<IConversation, 'leaderId' | 'creatorId'>,
): number {
  return members.filter((m) => resolveMemberRole(m, conversation) === 'admin').length;
}

function assertGroupAdminCapacity(
  members: IConversationMember[],
  conversation: Pick<IConversation, 'leaderId' | 'creatorId'>,
  additionalAdmins = 1,
): void {
  if (countGroupAdmins(members, conversation) + additionalAdmins > MAX_GROUP_ADMINS) {
    throw new ValidationError(GROUP_ADMIN_LIMIT_MESSAGE);
  }
}

async function broadcastAdminRoleChangeMessage(
  conversationId: string,
  actorUserId: string,
  targetUserId: string,
  change: 'promoted' | 'demoted',
  options?: { selfDemote?: boolean },
): Promise<void> {
  try {
    let actorName = resolveChatMemberLabel(actorUserId, null);
    let targetName = resolveChatMemberLabel(targetUserId, null);
    try {
      const users = await userRepository.findByIds([actorUserId, targetUserId]);
      const byId = new Map(users.map((u) => [u.userId, u]));
      actorName = resolveChatMemberLabel(actorUserId, byId.get(actorUserId) ?? null);
      targetName = resolveChatMemberLabel(targetUserId, byId.get(targetUserId) ?? null);
    } catch {
      /* ignore */
    }

    const actor: GroupSystemPerson = { userId: actorUserId, name: actorName };
    const target: GroupSystemPerson = { userId: targetUserId, name: targetName };
    const content =
      change === 'promoted'
        ? buildGroupAdminPromotedContent(actor, target)
        : buildGroupAdminDemotedContent(actor, target, Boolean(options?.selfDemote));

    await createAndBroadcastSystemMessage(
      { conversationId, senderId: actorUserId, content },
      sysMsgDeps,
    );
  } catch {
    /* ignore system message errors */
  }
}

function buildRoleAuditLog(input: {
  conversationId: string;
  actorUserId: string;
  targetUserId: string;
  previousRole: MemberRole;
  nextRole: MemberRole;
  action: IGroupRoleAuditLog['action'];
  metadata?: Record<string, unknown>;
  createdAt?: string;
}): IGroupRoleAuditLog {
  return {
    auditId: randomUUID(),
    conversationId: input.conversationId,
    actorUserId: input.actorUserId,
    targetUserId: input.targetUserId,
    previousRole: input.previousRole,
    nextRole: input.nextRole,
    action: input.action,
    createdAt: input.createdAt ?? new Date().toISOString(),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
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

  let role = resolveMemberRole(member, c);
  if (!role) {
    const members = await conversationRepository.getConversationMembers(conversationId);
    const fromList = members.find((m) => String(m.userId ?? '').trim() === userId);
    role = resolveMemberRole(fromList, c);
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
    const members = (await conversationRepository.getConversationMembers(groupId)).filter((m) =>
      Boolean(String(m.userId ?? '').trim()),
    );
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
          {
            conversationId,
            senderId: requesterId,
            content: `${userName} đổi tên nhóm thành '${data.name}'`,
          },
          sysMsgDeps,
        );
      } catch {
        /* ignore */
      }
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
          {
            conversationId,
            senderId: requesterId,
            content: `${userName} đã cập nhật ảnh đại diện nhóm`,
            mediaUrl: data.avatar,
            mediaType: 'image',
          },
          sysMsgDeps,
        );
      } catch {
        /* ignore */
      }
    }

    return updatedConversation;
  },

  deleteGroup: async (requesterId: string, conversationId: string): Promise<void> => {
    const conversation = await conversationRepository.getConversationById(conversationId);
    if (!conversation) throw new NotFoundError('Nhóm');
    if (conversation.type !== 'group') throw new ForbiddenError('Đây không phải nhóm chat');
    const requesterMember = await conversationRepository.getMember(conversationId, requesterId);
    if (!requesterMember) throw new ForbiddenError('Bạn không phải thành viên nhóm');
    const disbandRole = resolveMemberRole(requesterMember, conversation);
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

    await Promise.all(
      members.map((m) => conversationRepository.removeMember(conversationId, m.userId)),
    );
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

    const leaverRole = resolveMemberRole(member, conv);
    if (leaverRole !== 'owner') {
      let leaverLabel = resolveChatMemberLabel(userId, null);
      try {
        const users = await userRepository.findByIds([userId]);
        const byId = new Map(users.map((u) => [u.userId, u]));
        leaverLabel = resolveChatMemberLabel(userId, byId.get(userId) ?? null);
      } catch {
        /* ignore */
      }
      try {
        await createAndBroadcastSystemMessage(
          {
            conversationId,
            senderId: userId,
            content: buildGroupMemberLeftContent({ userId, name: leaverLabel }),
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
      throw new ValidationError(
        'Trưởng nhóm cần chọn thành viên nhận quyền trưởng nhóm trước khi rời nhóm.',
      );
    }
    const successor = allMembers.find((m) => m.userId === newOwnerId);
    if (!successor || successor.userId === userId) {
      throw new ValidationError('Thành viên được chọn không hợp lệ hoặc không thuộc nhóm.');
    }

    const newMemberCount = Math.max(0, afterLeave);
    const now = new Date().toISOString();
    const successorPreviousRole = resolveMemberRole(successor, conv) ?? 'member';
    const extraOwnerDemotions = allMembers
      .filter((m) => {
        if (m.userId === userId || m.userId === successor.userId) return false;
        return resolveMemberRole(m, conv) === 'owner';
      })
      .map((m) => ({ userId: m.userId, nextRole: 'member' }));

    await conversationRepository.applyGroupOwnerTransfer({
      conversationId,
      newOwnerUserId: successor.userId,
      previousOwnerUserId: userId,
      previousOwnerNewRole: 'member',
      extraOwnerDemotions,
      auditLogs: [
        buildRoleAuditLog({
          conversationId,
          actorUserId: userId,
          targetUserId: successor.userId,
          previousRole: successorPreviousRole,
          nextRole: 'owner',
          action: 'owner_leave_transfer',
          createdAt: now,
        }),
        buildRoleAuditLog({
          conversationId,
          actorUserId: userId,
          targetUserId: userId,
          previousRole: 'owner',
          nextRole: 'member',
          action: 'owner_leave_transfer',
          metadata: { leftGroup: true },
          createdAt: now,
        }),
        ...extraOwnerDemotions.map((m) =>
          buildRoleAuditLog({
            conversationId,
            actorUserId: userId,
            targetUserId: m.userId,
            previousRole: 'owner',
            nextRole: 'member',
            action: 'owner_leave_transfer',
            metadata: { repairedExtraOwner: true },
            createdAt: now,
          }),
        ),
      ],
    });
    await conversationRepository.updateConversation(conversationId, {
      memberCount: newMemberCount,
    });
    await conversationRepository.removeMember(conversationId, userId);

    try {
      let leaverLabel = resolveChatMemberLabel(userId, null);
      let successorLabel = resolveChatMemberLabel(successor.userId, null);
      try {
        const users = await userRepository.findByIds([userId, successor.userId]);
        const byId = new Map(users.map((u) => [u.userId, u]));
        leaverLabel = resolveChatMemberLabel(userId, byId.get(userId) ?? null);
        successorLabel = resolveChatMemberLabel(
          successor.userId,
          byId.get(successor.userId) ?? null,
        );
      } catch {
        /* ignore */
      }

      const leaverPerson: GroupSystemPerson = { userId, name: leaverLabel };
      const successorPerson: GroupSystemPerson = {
        userId: successor.userId,
        name: successorLabel,
      };

      await createAndBroadcastSystemMessage(
        {
          conversationId,
          senderId: userId,
          content: buildGroupMemberLeftContent(leaverPerson),
        },
        sysMsgDeps,
      );
      await createAndBroadcastSystemMessage(
        {
          conversationId,
          senderId: userId,
          content: buildGroupOwnerAssignedContent(successorPerson),
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

    const conversation = await conversationRepository.getConversationById(conversationId);
    if (!conversation || conversation.type !== 'group') throw new NotFoundError('Nhóm');

    const trimmedTarget = targetUserId.trim();
    const resolved = await conversationRepository.resolveMemberForRemoval(
      conversationId,
      trimmedTarget,
    );

    if (resolveMemberRole(resolved?.member, conversation) === 'owner') {
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
        targetName = resolveChatMemberLabel(deleteUserId, byId.get(deleteUserId) ?? targetWithName);
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
    const trimmedTarget = targetUserId.trim();
    if (!trimmedTarget) throw new ValidationError('Thành viên không hợp lệ');
    if (role === 'owner') {
      throw new ValidationError('Vui lòng dùng chức năng chuyển quyền trưởng nhóm');
    }

    const conversation = await conversationRepository.getConversationById(conversationId);
    if (!conversation) throw new NotFoundError('Nhóm');
    if (conversation.type !== 'group') throw new ForbiddenError('Đây không phải nhóm chat');

    const requesterMember = await conversationRepository.getMember(conversationId, requesterId);
    const requesterRole = resolveMemberRole(requesterMember, conversation);
    if (!requesterMember || !requesterRole) {
      throw new ForbiddenError('Bạn không phải thành viên nhóm');
    }

    const target = await conversationRepository.getMember(conversationId, trimmedTarget);
    if (!target) {
      throw new ValidationError('Thành viên được chọn không hợp lệ hoặc không thuộc nhóm.');
    }
    const targetRole = resolveMemberRole(target, conversation) ?? 'member';
    if (targetRole === 'owner') {
      throw new ForbiddenError(
        'Không thể hạ trưởng nhóm bằng đổi vai trò. Hãy chuyển quyền trước.',
      );
    }

    if (requesterId === trimmedTarget && requesterRole === 'admin' && role === 'member') {
      await conversationRepository.updateMemberRole(conversationId, trimmedTarget, 'member');
      await conversationRepository.createGroupRoleAuditLog(
        buildRoleAuditLog({
          conversationId,
          actorUserId: requesterId,
          targetUserId: trimmedTarget,
          previousRole: 'admin',
          nextRole: 'member',
          action: 'self_demote_admin',
        }),
      );
      await broadcastAdminRoleChangeMessage(conversationId, requesterId, trimmedTarget, 'demoted', {
        selfDemote: true,
      });
      return;
    }

    if (requesterRole !== 'owner') {
      throw new ForbiddenError('Chỉ trưởng nhóm mới có quyền thay đổi vai trò phó nhóm');
    }

    if (requesterId === trimmedTarget) {
      throw new ForbiddenError(
        'Trưởng nhóm cần chuyển quyền cho người khác trước khi tự hạ vai trò',
      );
    }

    if (targetRole === role) return;

    if (role === 'admin' && targetRole !== 'admin') {
      const allMembers = await conversationRepository.getConversationMembers(conversationId);
      assertGroupAdminCapacity(allMembers, conversation);
    }

    await conversationRepository.updateMemberRole(conversationId, trimmedTarget, role);
    await conversationRepository.createGroupRoleAuditLog(
      buildRoleAuditLog({
        conversationId,
        actorUserId: requesterId,
        targetUserId: trimmedTarget,
        previousRole: targetRole,
        nextRole: role,
        action: 'change_role',
      }),
    );

    if (role === 'admin' && targetRole !== 'admin') {
      await broadcastAdminRoleChangeMessage(conversationId, requesterId, trimmedTarget, 'promoted');
    } else if (role === 'member' && targetRole === 'admin') {
      await broadcastAdminRoleChangeMessage(conversationId, requesterId, trimmedTarget, 'demoted');
    }
    return;
  },

  transferGroupOwner: async (
    requesterId: string,
    conversationId: string,
    newOwnerUserId: string,
    currentOwnerNewRole: Extract<MemberRole, 'admin' | 'member'>,
  ): Promise<{
    previousOwnerUserId: string;
    newOwnerUserId: string;
    previousOwnerNewRole: Extract<MemberRole, 'admin' | 'member'>;
    roleChanges: Array<{ userId: string; role: MemberRole }>;
  }> => {
    const trimmedTarget = newOwnerUserId.trim();
    if (!trimmedTarget || trimmedTarget === requesterId) {
      throw new ValidationError('Vui lòng chọn một thành viên khác làm trưởng nhóm mới.');
    }

    const conversation = await conversationRepository.getConversationById(conversationId);
    if (!conversation) throw new NotFoundError('Nhóm');
    if (conversation.type !== 'group') throw new ForbiddenError('Đây không phải nhóm chat');
    if (conversation.isDeleted) throw new ForbiddenError('Nhóm đã được giải tán');

    const requester = await conversationRepository.getMember(conversationId, requesterId);
    if (!requester || resolveMemberRole(requester, conversation) !== 'owner') {
      throw new ForbiddenError('Chỉ trưởng nhóm mới có thể chuyển quyền');
    }

    const members = await conversationRepository.getConversationMembers(conversationId);
    const successor = members.find((m) => m.userId === trimmedTarget);
    if (!successor) {
      throw new ValidationError('Thành viên được chọn không hợp lệ hoặc không thuộc nhóm.');
    }

    if (currentOwnerNewRole === 'admin') {
      assertGroupAdminCapacity(members, conversation);
    }

    const now = new Date().toISOString();
    const successorPreviousRole = resolveMemberRole(successor, conversation) ?? 'member';
    const extraOwnerDemotions = members
      .filter((m) => {
        if (m.userId === requesterId || m.userId === trimmedTarget) return false;
        return resolveMemberRole(m, conversation) === 'owner';
      })
      .map((m) => ({ userId: m.userId, nextRole: 'member' }));

    await conversationRepository.applyGroupOwnerTransfer({
      conversationId,
      newOwnerUserId: trimmedTarget,
      previousOwnerUserId: requesterId,
      previousOwnerNewRole: currentOwnerNewRole,
      extraOwnerDemotions,
      auditLogs: [
        buildRoleAuditLog({
          conversationId,
          actorUserId: requesterId,
          targetUserId: trimmedTarget,
          previousRole: successorPreviousRole,
          nextRole: 'owner',
          action: 'transfer_owner',
          createdAt: now,
        }),
        buildRoleAuditLog({
          conversationId,
          actorUserId: requesterId,
          targetUserId: requesterId,
          previousRole: 'owner',
          nextRole: currentOwnerNewRole,
          action: 'transfer_owner',
          createdAt: now,
        }),
        ...extraOwnerDemotions.map((m) =>
          buildRoleAuditLog({
            conversationId,
            actorUserId: requesterId,
            targetUserId: m.userId,
            previousRole: 'owner',
            nextRole: 'member',
            action: 'transfer_owner',
            metadata: { repairedExtraOwner: true },
            createdAt: now,
          }),
        ),
      ],
    });

    try {
      let actorName = resolveChatMemberLabel(requesterId, null);
      let successorName = resolveChatMemberLabel(trimmedTarget, null);
      try {
        const users = await userRepository.findByIds([requesterId, trimmedTarget]);
        const byId = new Map(users.map((u) => [u.userId, u]));
        actorName = resolveChatMemberLabel(requesterId, byId.get(requesterId) ?? null);
        successorName = resolveChatMemberLabel(trimmedTarget, byId.get(trimmedTarget) ?? null);
      } catch {
        /* ignore */
      }

      await createAndBroadcastSystemMessage(
        {
          conversationId,
          senderId: requesterId,
          content: buildGroupOwnerTransferredContent(
            { userId: requesterId, name: actorName },
            { userId: trimmedTarget, name: successorName },
          ),
        },
        sysMsgDeps,
      );
    } catch {
      /* ignore system message errors */
    }

    return {
      previousOwnerUserId: requesterId,
      newOwnerUserId: trimmedTarget,
      previousOwnerNewRole: currentOwnerNewRole,
      roleChanges: [
        { userId: trimmedTarget, role: 'owner' },
        { userId: requesterId, role: currentOwnerNewRole },
        ...extraOwnerDemotions.map((m) => ({ userId: m.userId, role: 'member' as const })),
      ],
    };
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
    const settingsRole = resolveMemberRole(member, c);
    if (settingsRole !== 'owner') {
      throw new ForbiddenError('Chỉ trưởng nhóm mới chỉnh được cài đặt');
    }
    if (c.type !== 'group') throw new ForbiddenError('Đây không phải nhóm chat');

    const current = mergeGroupSettings(c.groupSettings);
    let joinLinkSuffix = current.joinLinkSuffix;
    if (patch.regenerateJoinLink) {
      const previousSuffix = joinLinkSuffix;
      joinLinkSuffix = randomBytes(6).toString('hex');
      if (previousSuffix) {
        await conversationRepository.deleteJoinLinkLookup(previousSuffix);
      }
    }
    const next: IGroupSettings = {
      memberPermissions: { ...current.memberPermissions, ...patch.memberPermissions },
      adminSettings: { ...current.adminSettings, ...patch.adminSettings },
      joinLinkSuffix,
    };

    await conversationRepository.updateConversation(conversationId, {
      groupSettings: next,
    } as any);

    if (joinLinkSuffix) {
      await conversationRepository.upsertJoinLinkLookup(conversationId, joinLinkSuffix);
    }

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
