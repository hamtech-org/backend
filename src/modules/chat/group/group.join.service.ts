import { conversationRepository } from '../conversation/conversation.repository.js';
import { memberRequestRepository } from '../member-request/member-request.repository.js';
import { mergeGroupSettings } from './group.service.js';
import { NotFoundError, ForbiddenError, ValidationError } from '@/shared/utils/errors.js';

export type GroupJoinPreview = {
  conversationId: string;
  name: string;
  avatar: string | null;
  memberCount: number;
  approvalRequired: boolean;
  isMember: boolean;
  requestStatus: 'pending' | 'invited' | null;
};

export type GroupJoinViaLinkResult = {
  conversationId: string;
  status: 'joined' | 'pending' | 'already_member';
  memberCount?: number;
};

async function resolveConversationForJoinSuffix(suffix: string) {
  const normalized = suffix.trim().toLowerCase();
  const conversationId =
    await conversationRepository.findConversationIdByJoinLinkSuffix(normalized);

  if (!conversationId) {
    throw new NotFoundError('Link mời không hợp lệ hoặc đã hết hạn');
  }

  const conversation = await conversationRepository.getConversationById(conversationId);
  if (!conversation || conversation.type !== 'group' || conversation.isDeleted) {
    throw new NotFoundError('Link mời không hợp lệ hoặc đã hết hạn');
  }

  const settings = mergeGroupSettings(conversation.groupSettings);
  if (!settings.adminSettings.allowJoinLink) {
    throw new ForbiddenError('Nhóm đã tắt tham gia bằng link');
  }

  const storedSuffix = String(settings.joinLinkSuffix ?? '')
    .trim()
    .toLowerCase();
  if (storedSuffix !== normalized) {
    throw new NotFoundError('Link mời không hợp lệ hoặc đã hết hạn');
  }

  await conversationRepository.upsertJoinLinkLookup(conversationId, storedSuffix);

  return { conversation, settings };
}

export const groupJoinService = {
  getJoinPreview: async (suffix: string, viewerUserId?: string): Promise<GroupJoinPreview> => {
    const { conversation } = await resolveConversationForJoinSuffix(suffix);
    const conversationId = conversation.conversationId;

    let isMember = false;
    let requestStatus: 'pending' | 'invited' | null = null;

    if (viewerUserId) {
      const member = await conversationRepository.getMember(conversationId, viewerUserId);
      isMember = !!member;
      if (!isMember) {
        const req = await memberRequestRepository.getGroupRequest(conversationId, viewerUserId);
        requestStatus = req?.status ?? null;
      }
    }

    return {
      conversationId,
      name: conversation.name ?? 'Nhóm chat',
      avatar: conversation.avatar ?? null,
      memberCount:
        typeof conversation.memberCount === 'number'
          ? conversation.memberCount
          : (await conversationRepository.getConversationMembers(conversationId)).length,
      /** Tham gia bằng link luôn chờ Admin/Owner duyệt, kể cả khi nhóm tắt cờ trong cài đặt. */
      approvalRequired: true,
      isMember,
      requestStatus,
    };
  },

  joinViaLink: async (userId: string, suffix: string): Promise<GroupJoinViaLinkResult> => {
    const trimmedUserId = userId.trim();
    if (!trimmedUserId) throw new ValidationError('Thiếu thông tin người dùng');

    const { conversation } = await resolveConversationForJoinSuffix(suffix);
    const conversationId = conversation.conversationId;

    const existing = await conversationRepository.getMember(conversationId, trimmedUserId);
    if (existing) {
      return { conversationId, status: 'already_member', memberCount: conversation.memberCount };
    }

    const pending = await memberRequestRepository.getGroupRequest(conversationId, trimmedUserId);
    if (pending) {
      return { conversationId, status: 'pending' };
    }

    await memberRequestRepository.createGroupRequest(conversationId, trimmedUserId, 'pending');
    return { conversationId, status: 'pending' };
  },
};
