import { conversationRepository } from '../conversation/conversation.repository.js';
import { randomBytes } from 'node:crypto';
import type {
  IConversationMember,
  IUpdateGroupDto,
  IAddMembersDto,
  IGroupSettings,
} from '../shared/chat.types.js';
import { NotFoundError, ForbiddenError } from '@/shared/utils/errors.js';
import { userRepository } from '@/modules/user/user.repository.js';
import { createAndBroadcastSystemMessage } from '../shared/system-message.factory.js';
import type { MemberRole } from '@/shared/types/chat.types.js';

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
    const members = await conversationRepository.getConversationMembers(groupId);
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

    if (
      (data.name !== undefined || data.avatar !== undefined) &&
      member.role === 'member'
    ) {
      const s = mergeGroupSettings(conversation.groupSettings);
      if (!s.memberPermissions.changeNameAvatar) {
        throw new ForbiddenError('Nhóm không cho phép thành viên đổi tên hoặc ảnh đại diện nhóm');
      }
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
    if (conversation.creatorId !== requesterId) {
      throw new ForbiddenError('Chỉ người tạo nhóm mới có quyền giải tán');
    }

    await conversationRepository.updateConversation(conversationId, {
      name: `[ĐÃ GIẢI TÁN] ${conversation.name}`,
      isDeleted: true,
    } as any);
  },

  leaveGroup: async (userId: string, conversationId: string): Promise<void> => {
    const member = await conversationRepository.getMember(conversationId, userId);
    if (!member) throw new NotFoundError('Thành viên nhóm');
    if (member.role === 'owner') {
      throw new Error('Chủ nhóm không thể rời. Hãy chuyển quyền hoặc giải tán nhóm.');
    }

    await conversationRepository.removeMember(conversationId, userId);

    const conv = await conversationRepository.getConversationById(conversationId);
    if (conv) {
      await conversationRepository.updateConversation(conversationId, {
        memberCount: Math.max(0, (conv.memberCount || 0) - 1),
      });
    }
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

    const now = new Date().toISOString();
    const { memberRequestRepository } = await import('../member-request/member-request.repository.js');

    const memberIdsToInvite: string[] = [];
    for (const userId of data.memberIds) {
      const alreadyMember = await conversationRepository.getMember(conversationId, userId);
      if (alreadyMember) continue;
      memberIdsToInvite.push(userId);
    }
    if (memberIdsToInvite.length === 0) return;

    await Promise.all(
      memberIdsToInvite.map((userId) =>
        memberRequestRepository.createGroupRequest(conversationId, userId, 'invited'),
      ),
    );

    // System message: ai đã mời ai vào nhóm
    try {
      let requesterName = 'Ai đó';
      try {
        const users = await userRepository.findByIds([requesterId]);
        requesterName = users[0]?.displayName || requesterName;
      } catch {}

      let invitedNames: string[] = [];
      try {
        const invitedProfiles = await userRepository.findByIds(memberIdsToInvite);
        const nameById = new Map(
          invitedProfiles.map((u) => [u.userId, u.displayName || u.email || u.userId]),
        );
        invitedNames = memberIdsToInvite.map((id) => nameById.get(id) ?? id);
      } catch {
        invitedNames = memberIdsToInvite;
      }

      const previewList = invitedNames.slice(0, 3).join(', ');
      const moreCount = Math.max(0, invitedNames.length - 3);
      const invitedLabel =
        moreCount > 0 ? `${previewList} và ${moreCount} người khác` : previewList;

      await createAndBroadcastSystemMessage(
        { conversationId, senderId: requesterId, content: `${requesterName} đã mời ${invitedLabel} vào nhóm` },
        sysMsgDeps,
      );
    } catch {
      // ignore system message errors, do not fail main addMembers flow
    }
  },

  removeMember: async (
    requesterId: string,
    conversationId: string,
    targetUserId: string,
  ): Promise<void> => {
    const requester = await conversationRepository.getMember(conversationId, requesterId);
    if (!requester || !['owner', 'admin'].includes(requester.role)) {
      throw new ForbiddenError('Chỉ Admin/Owner mới có quyền xóa thành viên');
    }

    const target = await conversationRepository.getMember(conversationId, targetUserId);
    if (!target) throw new NotFoundError('Thành viên');
    if (target.role === 'owner') throw new ForbiddenError('Không thể xóa chủ nhóm');

    await conversationRepository.removeMember(conversationId, targetUserId);

    const conv = await conversationRepository.getConversationById(conversationId);
    if (conv) {
      await conversationRepository.updateConversation(conversationId, {
        memberCount: Math.max(0, (conv.memberCount || 0) - 1),
      });
    }

    // System message: ai đã mời ai ra khỏi nhóm
    try {
      let requesterName = 'Ai đó';
      let targetName = targetUserId;
      try {
        const users = await userRepository.findByIds([requesterId, targetUserId]);
        const byId = new Map(users.map((u) => [u.userId, u]));
        requesterName = byId.get(requesterId)?.displayName ?? requesterName;
        targetName = byId.get(targetUserId)?.displayName ?? targetName;
      } catch {}

      await createAndBroadcastSystemMessage(
        { conversationId, senderId: requesterId, content: `${requesterName} đã mời ${targetName} ra khỏi nhóm` },
        sysMsgDeps,
      );
    } catch {
      // ignore system message errors
    }
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
    if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
      throw new ForbiddenError('Chỉ trưởng nhóm hoặc phó nhóm mới chỉnh được cài đặt');
    }
    const c = await conversationRepository.getConversationById(conversationId);
    if (!c) throw new NotFoundError('Hội thoại');
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
    const c = await conversationRepository.getConversationById(conversationId);
    if (!c) throw new NotFoundError('Hội thoại');
    if (c.type === 'group') {
      const member = await conversationRepository.getMember(conversationId, userId);
      if (!member) throw new ForbiddenError('Bạn không phải thành viên nhóm');
      if (member.role === 'owner' || member.role === 'admin') return;
      const s = mergeGroupSettings(c.groupSettings);
      if (!s.memberPermissions.pinMessages) {
        throw new ForbiddenError('Nhóm không cho phép thành viên ghim tin nhắn');
      }
    }
  },
};
