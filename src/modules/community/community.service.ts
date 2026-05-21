import { v4 as uuidv4 } from 'uuid';
import { getKafkaProducer } from '@/config/kafka.js';
import { KAFKA_TOPICS } from '@/shared/constants/kafkaTopics.js';
import { logger } from '@/shared/utils/logger.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/shared/utils/errors.js';
import { notificationService } from '@/modules/notification/notification.service.js';
import { newsfeedRepository } from '@/modules/newsfeed/newsfeed.repository.js';
import { userRepository } from '@/modules/user/user.repository.js';
import type { IPost, ReactionType } from '@/modules/newsfeed/newsfeed.types.js';
import { communityRepository, padMs } from './community.repository.js';
import type {
  CommunityContentType,
  CommunityMemberRole,
  ICommunity,
  ICommunityContentIndex,
  ICommunityJoinRequest,
  ICommunityListPage,
  ICommunityMember,
  ICommunityPostsPage,
  ICreateCommunityDto,
  IJoinCommunityDto,
  IJoinCommunityResult,
  IListCommunitiesQuery,
  IResolveJoinRequestDto,
  ITransferOwnerDto,
  IUpdateCommunityDto,
  IUpdateMemberRoleDto,
  CommunityModerationAction,
  CommunityModerationTargetType,
  ICommunityModerationLog,
  ICommunityModerationLogsPage,
} from './community.types.js';

type ISearchIndexEvent = {
  action: 'index' | 'update' | 'delete';
  indexName: 'groups';
  documentId: string;
  document: Record<string, unknown> | null;
};

const ROLE_RANK: Record<CommunityMemberRole, number> = {
  member: 1,
  moderator: 2,
  admin: 3,
  owner: 4,
};

const encodeCursor = (key: Record<string, unknown>): string =>
  Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');

const decodeCursor = (cursor?: string): Record<string, unknown> | undefined => {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

const normalizeSlug = (input: string): string => {
  const normalized = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return normalized || `community-${Date.now()}`;
};

const isConditionalFailure = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  String((error as { name?: string }).name) === 'TransactionCanceledException';

const emitCommunityIndexEvent = async (event: ISearchIndexEvent): Promise<void> => {
  try {
    const producer = getKafkaProducer();
    await producer.send({
      topic: KAFKA_TOPICS.SEARCH_INDEX,
      messages: [
        {
          key: event.documentId,
          value: JSON.stringify(event),
        },
      ],
    });
  } catch (error) {
    logger.error(`Emit search.index event failed for community ${event.documentId}:`, error);
  }
};

const toSearchDocument = (community: ICommunity): Record<string, unknown> => ({
  groupId: community.groupId,
  communityId: community.communityId,
  name: community.name,
  slug: community.slug,
  description: community.description,
  avatar: community.avatar,
  coverUrl: community.coverUrl,
  category: community.category,
  memberCount: community.memberCount,
  type: community.type,
  status: community.status,
  isActive: community.isActive,
  createdAt: community.createdAt,
});

const buildMember = (
  groupId: string,
  userId: string,
  role: CommunityMemberRole,
  joinedAt: string,
  joinedAtMs: number,
): ICommunityMember => ({
  groupId,
  communityId: groupId,
  userId,
  role,
  status: 'active',
  joinedAt,
  joinedAtMs,
  GSI1PK: `USER#${userId}`,
  GSI1SK: `JOINED#${padMs(joinedAtMs)}#${groupId}`,
});

const requireActiveCommunity = async (groupId: string): Promise<ICommunity> => {
  const community = await communityRepository.getCommunityById(groupId);
  if (!community || !community.isActive || community.status === 'archived') {
    throw new NotFoundError('Cộng đồng');
  }
  return community;
};

const attachViewerState = async (community: ICommunity, userId: string): Promise<ICommunity> => {
  const [member, request] = await Promise.all([
    communityRepository.getMember(community.groupId, userId),
    communityRepository.getJoinRequest(community.groupId, userId),
  ]);
  return {
    ...community,
    viewerRole: member?.status === 'active' ? member.role : null,
    viewerStatus: member?.status ?? null,
    joinRequestStatus: request?.status ?? null,
  };
};

const enrichPosts = async (validPosts: IPost[], actorId: string): Promise<IPost[]> => {
  if (validPosts.length === 0) return [];

  // 1. Enrich Author Info
  const authorIds = Array.from(new Set(validPosts.map((p) => p.authorId)));
  const users = authorIds.length > 0 ? await userRepository.findMultipleById(authorIds) : [];
  const userMap = new Map(users.map((u) => [u.userId, u]));

  let enriched = validPosts.map((p) => {
    const u = userMap.get(p.authorId);
    return {
      ...p,
      author: u
        ? {
            userId: p.authorId,
            displayName: u.displayName ?? p.authorId,
            avatar: u.avatar ?? null,
          }
        : { userId: p.authorId, displayName: p.authorId, avatar: null },
    };
  });

  // 2. Enrich Current User Reaction
  enriched = await Promise.all(
    enriched.map(async (p) => {
      const reaction = await newsfeedRepository.getReaction(p.postId, actorId);
      return {
        ...p,
        currentUserReaction: (reaction?.type as ReactionType) ?? null,
      };
    }),
  );

  // 3. Enrich Saved Status
  const postIds = enriched.map((p) => p.postId);
  const savedIds =
    postIds.length > 0
      ? await newsfeedRepository.getSavedPostIds(actorId, postIds)
      : new Set<string>();
  enriched = enriched.map((p) => ({
    ...p,
    isSaved: savedIds.has(p.postId),
  }));

  // 4. Enrich Shared Post Author Info
  const needEnrichShared = enriched.filter((p) => p.sharedFrom && !p.sharedFrom.author);
  if (needEnrichShared.length > 0) {
    const sharedAuthorIds = Array.from(
      new Set(needEnrichShared.map((p) => p.sharedFrom!.authorId)),
    );
    const sharedUsers = await userRepository.findMultipleById(sharedAuthorIds);
    const sharedUserMap = new Map(sharedUsers.map((u) => [u.userId, u]));
    enriched = enriched.map((p) => {
      if (!p.sharedFrom || p.sharedFrom.author) return p;
      const u = sharedUserMap.get(p.sharedFrom.authorId);
      return {
        ...p,
        sharedFrom: {
          ...p.sharedFrom,
          author: u
            ? {
                userId: u.userId,
                displayName: u.displayName ?? u.userId,
                avatar: u.avatar ?? null,
              }
            : { userId: p.sharedFrom.authorId, displayName: p.sharedFrom.authorId, avatar: null },
        },
      };
    });
  }

  return enriched;
};

export const communityService = {
  normalizeSlug,

  writeModerationLog: async (
    actorId: string,
    groupId: string,
    action: CommunityModerationAction,
    targetId: string,
    targetType: CommunityModerationTargetType,
    targetName?: string,
    reason?: string,
    metadata?: Record<string, any>,
  ): Promise<void> => {
    const logId = uuidv4();
    const now = new Date();
    const log: ICommunityModerationLog = {
      groupId,
      communityId: groupId,
      logId,
      actorId,
      action,
      targetId,
      targetType,
      targetName,
      reason,
      metadata,
      createdAt: now.toISOString(),
      createdAtMs: now.getTime(),
    };
    try {
      await communityRepository.createModerationLog(log);
    } catch (err) {
      logger.error(`Write moderation log failed for group ${groupId}, action ${action}:`, err);
    }
  },

  listModerationLogs: async (
    actorId: string,
    groupId: string,
    limit?: number,
    cursor?: string,
  ): Promise<ICommunityModerationLogsPage> => {
    await communityService.assertCommunityRole(actorId, groupId, ['owner', 'admin', 'moderator']);
    const resolvedLimit = Math.min(limit ?? 20, 100);
    const decoded = decodeCursor(cursor);
    const page = await communityRepository.listModerationLogs(groupId, resolvedLimit, decoded);

    if (page.items.length === 0) {
      return {
        items: [],
        nextCursor: null,
        hasMore: false,
      };
    }

    const userIds = new Set<string>();
    for (const log of page.items) {
      if (log.actorId) userIds.add(log.actorId);
      if (log.targetType === 'member' && log.targetId) {
        userIds.add(log.targetId);
      }
    }

    const uniqueUserIds = Array.from(userIds);
    const users =
      uniqueUserIds.length > 0 ? await userRepository.findMultipleById(uniqueUserIds) : [];
    const userMap = new Map(users.map((u) => [u.userId, u]));

    const items = page.items.map((log) => {
      const actorUser = userMap.get(log.actorId);
      const targetUser = log.targetType === 'member' ? userMap.get(log.targetId) : undefined;

      return {
        ...log,
        actorInfo: actorUser
          ? {
              userId: log.actorId,
              displayName: actorUser.displayName ?? log.actorId,
              avatar: actorUser.avatar ?? null,
            }
          : { userId: log.actorId, displayName: log.actorId, avatar: null },
        targetUserInfo:
          log.targetType === 'member'
            ? targetUser
              ? {
                  userId: log.targetId,
                  displayName: targetUser.displayName ?? log.targetId,
                  avatar: targetUser.avatar ?? null,
                }
              : { userId: log.targetId, displayName: log.targetId, avatar: null }
            : undefined,
      };
    });

    return {
      items,
      nextCursor: page.lastEvaluatedKey ? encodeCursor(page.lastEvaluatedKey) : null,
      hasMore: Boolean(page.lastEvaluatedKey),
    };
  },

  deleteCommunityPost: async (
    groupId: string,
    postId: string,
    createdAtMs: number,
  ): Promise<void> => {
    await communityRepository.deleteContentIndex(groupId, 'post', postId, createdAtMs);
  },

  assertActiveMember: async (userId: string, groupId: string): Promise<ICommunityMember> => {
    const community = await requireActiveCommunity(groupId);
    const member = await communityRepository.getMember(community.groupId, userId);
    if (!member || member.status !== 'active') {
      throw new ForbiddenError('Bạn chưa là thành viên cộng đồng');
    }
    return member;
  },

  assertCommunityRole: async (
    userId: string,
    groupId: string,
    allowedRoles: CommunityMemberRole[],
  ): Promise<ICommunityMember> => {
    const member = await communityService.assertActiveMember(userId, groupId);
    if (!allowedRoles.includes(member.role)) {
      throw new ForbiddenError('Bạn không có quyền trong cộng đồng này');
    }
    return member;
  },

  canViewCommunity: async (userId: string, community: ICommunity): Promise<boolean> => {
    if (!community.isActive || community.status === 'archived') return false;
    if (community.type === 'public') return true;
    const member = await communityRepository.getMember(community.groupId, userId);
    return member?.status === 'active';
  },

  createCommunity: async (ownerId: string, data: ICreateCommunityDto): Promise<ICommunity> => {
    const now = new Date();
    const createdAt = now.toISOString();
    const createdAtMs = now.getTime();
    const groupId = uuidv4();
    const slug = normalizeSlug(data.slug ?? data.name);
    const joinPolicy = data.joinPolicy ?? (data.type === 'private' ? 'approval' : 'open');

    const community: ICommunity = {
      groupId,
      communityId: groupId,
      name: data.name.trim(),
      slug,
      description: data.description ?? null,
      avatar: data.avatar ?? null,
      coverUrl: data.coverUrl ?? null,
      category: data.category ?? 'general',
      rules: data.rules,
      type: data.type,
      joinPolicy,
      creatorId: ownerId,
      ownerId,
      memberCount: 1,
      postCount: 0,
      popularityScore: 0,
      isApprovalRequired: joinPolicy === 'approval',
      isPostApprovalRequired: data.isPostApprovalRequired ?? false,
      conversationId: null,
      isActive: true,
      status: 'active',
      createdAt,
      createdAtMs,
      updatedAt: createdAt,
    };

    const ownerMember = buildMember(groupId, ownerId, 'owner', createdAt, createdAtMs);

    try {
      await communityRepository.createCommunity(community, ownerMember);
    } catch (error) {
      if (isConditionalFailure(error)) throw new ConflictError('Slug cộng đồng đã tồn tại');
      throw error;
    }

    await emitCommunityIndexEvent({
      action: 'index',
      indexName: 'groups',
      documentId: groupId,
      document: toSearchDocument(community),
    });

    return attachViewerState(community, ownerId);
  },

  listCommunities: async (
    userId: string,
    query: IListCommunitiesQuery,
  ): Promise<ICommunityListPage> => {
    const limit = query.limit ?? 20;
    const cursor = decodeCursor(query.cursor);

    if (query.scope === 'joined') {
      const page = await communityRepository.listJoinedByUser(userId, limit, cursor);
      const groupIds = page.items.map((item) => item.groupId);
      const communities = await communityRepository.batchGetCommunities(groupIds);
      const visible = communities.filter((item) => item.isActive && item.status === 'active');
      return {
        items: await Promise.all(visible.map((item) => attachViewerState(item, userId))),
        nextCursor: page.lastEvaluatedKey ? encodeCursor(page.lastEvaluatedKey) : null,
        hasMore: Boolean(page.lastEvaluatedKey),
      };
    }

    const page = query.category
      ? await communityRepository.listByCategory(query.category, limit, cursor)
      : await communityRepository.listAll(limit, cursor);
    return {
      items: await Promise.all(page.items.map((item) => attachViewerState(item, userId))),
      nextCursor: page.lastEvaluatedKey ? encodeCursor(page.lastEvaluatedKey) : null,
      hasMore: Boolean(page.lastEvaluatedKey),
    };
  },

  getCommunity: async (userId: string, groupId: string): Promise<ICommunity> => {
    const community = await requireActiveCommunity(groupId);
    const canView = await communityService.canViewCommunity(userId, community);
    if (!canView) throw new ForbiddenError('Không có quyền xem cộng đồng riêng tư');
    return attachViewerState(community, userId);
  },

  updateCommunity: async (
    actorId: string,
    groupId: string,
    data: IUpdateCommunityDto,
  ): Promise<ICommunity> => {
    await communityService.assertCommunityRole(actorId, groupId, ['owner', 'admin']);
    const existing = await requireActiveCommunity(groupId);
    const now = new Date().toISOString();
    const nextSlug = data.slug ? normalizeSlug(data.slug) : undefined;
    const joinPolicy = data.joinPolicy ?? existing.joinPolicy;
    const nextCategory = data.category ?? existing.category;
    const popularityScore = existing.popularityScore ?? 0;
    const paddedScore = Math.round(popularityScore * 1000)
      .toString()
      .padStart(10, '0');
    const updates: Record<string, unknown> = {
      updatedAt: now,
      GSI2PK: `CATEGORY#${nextCategory}`,
      GSI2SK: `POPULAR#${paddedScore}#${groupId}`,
    };

    const changedFields: Record<string, { old: any; new: any }> = {};
    if (data.name !== undefined && data.name.trim() !== existing.name) {
      changedFields.name = { old: existing.name, new: data.name.trim() };
      updates.name = data.name.trim();
    }
    if (nextSlug && nextSlug !== existing.slug) {
      changedFields.slug = { old: existing.slug, new: nextSlug };
      updates.slug = nextSlug;
    }
    if (data.description !== undefined && data.description !== existing.description) {
      changedFields.description = { old: existing.description, new: data.description };
      updates.description = data.description;
    }
    if (data.avatar !== undefined && data.avatar !== existing.avatar) {
      changedFields.avatar = { old: existing.avatar, new: data.avatar };
      updates.avatar = data.avatar;
    }
    if (data.coverUrl !== undefined && data.coverUrl !== existing.coverUrl) {
      changedFields.coverUrl = { old: existing.coverUrl, new: data.coverUrl };
      updates.coverUrl = data.coverUrl;
    }
    if (data.category !== undefined && data.category !== existing.category) {
      changedFields.category = { old: existing.category, new: data.category };
      updates.category = data.category;
    }
    if (data.rules !== undefined) {
      changedFields.rules = { old: existing.rules, new: data.rules };
      updates.rules = data.rules;
    }
    if (data.type !== undefined && data.type !== existing.type) {
      changedFields.type = { old: existing.type, new: data.type };
      updates.type = data.type;
    }
    if (data.joinPolicy !== undefined && data.joinPolicy !== existing.joinPolicy) {
      changedFields.joinPolicy = { old: existing.joinPolicy, new: data.joinPolicy };
      updates.joinPolicy = joinPolicy;
      updates.isApprovalRequired = joinPolicy === 'approval';
    }
    if (
      data.isPostApprovalRequired !== undefined &&
      data.isPostApprovalRequired !== existing.isPostApprovalRequired
    ) {
      changedFields.isPostApprovalRequired = {
        old: existing.isPostApprovalRequired,
        new: data.isPostApprovalRequired,
      };
      updates.isPostApprovalRequired = data.isPostApprovalRequired;
    }

    try {
      const updated = await communityRepository.updateCommunity(
        groupId,
        updates as Partial<ICommunity>,
        existing.slug,
        nextSlug,
      );
      await emitCommunityIndexEvent({
        action: 'update',
        indexName: 'groups',
        documentId: groupId,
        document: toSearchDocument(updated),
      });

      if (Object.keys(changedFields).length > 0) {
        await communityService.writeModerationLog(
          actorId,
          groupId,
          'update_settings',
          groupId,
          'community',
          existing.name,
          undefined,
          { changedFields },
        );
      }

      return attachViewerState(updated, actorId);
    } catch (error) {
      if (isConditionalFailure(error)) throw new ConflictError('Slug cộng đồng đã tồn tại');
      throw error;
    }
  },

  archiveCommunity: async (actorId: string, groupId: string): Promise<void> => {
    const community = await requireActiveCommunity(groupId);
    if (community.ownerId !== actorId) {
      throw new ForbiddenError('Chỉ owner mới được archive cộng đồng');
    }
    await communityRepository.archiveCommunity(groupId, actorId);
    await emitCommunityIndexEvent({
      action: 'update',
      indexName: 'groups',
      documentId: groupId,
      document: { ...toSearchDocument(community), isActive: false, status: 'archived' },
    });
  },

  joinCommunity: async (
    userId: string,
    groupId: string,
    data: IJoinCommunityDto,
  ): Promise<IJoinCommunityResult> => {
    const community = await requireActiveCommunity(groupId);
    const existingMember = await communityRepository.getMember(groupId, userId);
    if (existingMember?.status === 'banned')
      throw new ForbiddenError('Bạn đã bị chặn khỏi cộng đồng');
    if (existingMember?.status === 'active') {
      return { status: 'already_member', community: await attachViewerState(community, userId) };
    }

    if (community.type === 'public' && community.joinPolicy === 'open') {
      const joinedAtMs = Date.now();
      const joinedAt = new Date(joinedAtMs).toISOString();
      try {
        await communityRepository.putOpenMember(
          buildMember(groupId, userId, 'member', joinedAt, joinedAtMs),
        );
      } catch (error) {
        if (isConditionalFailure(error)) {
          return {
            status: 'already_member',
            community: await attachViewerState(community, userId),
          };
        }
        throw error;
      }
      const updated = await requireActiveCommunity(groupId);
      return { status: 'joined', community: await attachViewerState(updated, userId) };
    }

    const existingRequest = await communityRepository.getJoinRequest(groupId, userId);
    if (existingRequest?.status === 'pending') {
      return { status: 'already_pending', community: await attachViewerState(community, userId) };
    }

    const requestedAtMs = Date.now();
    const requestedAt = new Date(requestedAtMs).toISOString();
    const request: ICommunityJoinRequest = {
      groupId,
      communityId: groupId,
      userId,
      status: 'pending',
      requestedAt,
      requestedAtMs,
      message: data.message,
    };

    try {
      await communityRepository.createJoinRequest(request, {
        groupId,
        communityId: groupId,
        userId,
        requestedAt,
        requestedAtMs,
        message: data.message,
      });
    } catch (error) {
      if (isConditionalFailure(error)) {
        return { status: 'already_pending', community: await attachViewerState(community, userId) };
      }
      throw error;
    }

    await notificationService.dispatch({
      userId: community.ownerId,
      type: 'group_invite',
      title: 'Yêu cầu tham gia cộng đồng',
      body: `Có người muốn tham gia ${community.name}`,
      data: { route: 'community', id: groupId, extra: { requesterId: userId } },
    });

    return { status: 'requested', community: await attachViewerState(community, userId) };
  },

  leaveCommunity: async (userId: string, groupId: string): Promise<void> => {
    const member = await communityService.assertActiveMember(userId, groupId);
    if (member.role === 'owner') {
      throw new ValidationError('Owner phải chuyển quyền trước khi rời cộng đồng');
    }
    await communityRepository.leaveCommunity(groupId, userId);
  },

  listMembers: async (actorId: string, groupId: string): Promise<ICommunityMember[]> => {
    const community = await requireActiveCommunity(groupId);
    if (community.type === 'private') await communityService.assertActiveMember(actorId, groupId);
    return communityRepository.listMembers(groupId);
  },

  listPendingRequests: async (
    actorId: string,
    groupId: string,
  ): Promise<ICommunityJoinRequest[]> => {
    await communityService.assertCommunityRole(actorId, groupId, ['owner', 'admin', 'moderator']);
    const pending = await communityRepository.listPendingRequests(groupId);
    const requests = await Promise.all(
      pending.map((item) => communityRepository.getJoinRequest(groupId, item.userId)),
    );
    return requests.filter(
      (item): item is ICommunityJoinRequest => !!item && item.status === 'pending',
    );
  },

  resolveJoinRequest: async (
    actorId: string,
    groupId: string,
    userId: string,
    data: IResolveJoinRequestDto,
  ): Promise<void> => {
    const community = await requireActiveCommunity(groupId);
    await communityService.assertCommunityRole(actorId, groupId, ['owner', 'admin', 'moderator']);
    const request = await communityRepository.getJoinRequest(groupId, userId);
    if (!request || request.status !== 'pending') throw new NotFoundError('Yêu cầu tham gia');

    const targetUser = await userRepository.findById(userId);
    const targetName = targetUser?.displayName ?? userId;

    if (data.action === 'approve') {
      const joinedAtMs = Date.now();
      const joinedAt = new Date(joinedAtMs).toISOString();
      try {
        await communityRepository.approveJoinRequest(
          request,
          buildMember(groupId, userId, 'member', joinedAt, joinedAtMs),
          actorId,
        );
        await communityService.writeModerationLog(
          actorId,
          groupId,
          'approve_join',
          userId,
          'member',
          targetName,
        );
      } catch (error) {
        if (!isConditionalFailure(error)) throw error;
      }
    } else {
      await communityRepository.rejectJoinRequest(request, actorId);
      await communityService.writeModerationLog(
        actorId,
        groupId,
        'reject_join',
        userId,
        'member',
        targetName,
      );
    }

    await notificationService.dispatch({
      userId,
      type: 'group_invite',
      title:
        data.action === 'approve'
          ? 'Yêu cầu tham gia đã được duyệt'
          : 'Yêu cầu tham gia đã bị từ chối',
      body:
        data.action === 'approve'
          ? `Bạn đã là thành viên của ${community.name}`
          : `Yêu cầu tham gia ${community.name} đã bị từ chối`,
      data: { route: 'community', id: groupId, extra: { action: data.action } },
    });
  },

  removeMember: async (actorId: string, groupId: string, targetUserId: string): Promise<void> => {
    const actor = await communityService.assertCommunityRole(actorId, groupId, [
      'owner',
      'admin',
      'moderator',
    ]);
    const target = await communityRepository.getMember(groupId, targetUserId);
    if (!target || target.status !== 'active') throw new NotFoundError('Thành viên');
    if (ROLE_RANK[actor.role] <= ROLE_RANK[target.role]) {
      throw new ForbiddenError('Không thể xử lý thành viên có quyền ngang hoặc cao hơn');
    }

    const targetUser = await userRepository.findById(targetUserId);
    const targetName = targetUser?.displayName ?? targetUserId;

    await communityRepository.banMember(groupId, targetUserId);
    await communityService.writeModerationLog(
      actorId,
      groupId,
      'ban_member',
      targetUserId,
      'member',
      targetName,
    );
  },

  updateMemberRole: async (
    actorId: string,
    groupId: string,
    targetUserId: string,
    data: IUpdateMemberRoleDto,
  ): Promise<void> => {
    await communityService.assertCommunityRole(actorId, groupId, ['owner']);
    const target = await communityRepository.getMember(groupId, targetUserId);
    if (!target || target.status !== 'active') throw new NotFoundError('Thành viên');
    if (target.role === 'owner')
      throw new ValidationError('Dùng transfer owner để chuyển quyền owner');

    const targetUser = await userRepository.findById(targetUserId);
    const targetName = targetUser?.displayName ?? targetUserId;

    await communityRepository.updateMemberRole(groupId, targetUserId, data.role);
    await communityService.writeModerationLog(
      actorId,
      groupId,
      'change_role',
      targetUserId,
      'member',
      targetName,
      undefined,
      { oldRole: target.role, newRole: data.role },
    );
  },

  transferOwner: async (
    actorId: string,
    groupId: string,
    data: ITransferOwnerDto,
  ): Promise<void> => {
    await communityService.assertCommunityRole(actorId, groupId, ['owner']);
    if (data.targetUserId === actorId) throw new ValidationError('Target đã là owner hiện tại');
    const target = await communityRepository.getMember(groupId, data.targetUserId);
    if (!target || target.status !== 'active') throw new NotFoundError('Thành viên nhận quyền');

    const targetUser = await userRepository.findById(data.targetUserId);
    const targetName = targetUser?.displayName ?? data.targetUserId;

    await communityRepository.transferOwner(groupId, actorId, data.targetUserId);
    await communityService.writeModerationLog(
      actorId,
      groupId,
      'transfer_ownership',
      data.targetUserId,
      'member',
      targetName,
    );
  },

  addContentIndex: async (
    groupId: string,
    contentType: CommunityContentType,
    contentId: string,
    authorId: string,
    createdAt: string,
    createdAtMs: number,
  ): Promise<void> => {
    await communityRepository.addContentIndex({
      groupId,
      communityId: groupId,
      contentType,
      contentId,
      authorId,
      createdAt,
      createdAtMs,
    });
  },

  listCommunityPosts: async (
    actorId: string,
    groupId: string,
    limit?: number,
    cursor?: string,
  ): Promise<ICommunityPostsPage> => {
    const community = await communityService.getCommunity(actorId, groupId);
    if (!community.isActive) throw new NotFoundError('Cộng đồng');

    const pinnedIds = community.pinnedPostIds || [];
    let pinnedPosts: IPost[] = [];

    // Only load pinned posts on the first page
    if (!cursor && pinnedIds.length > 0) {
      const rawPinned = await Promise.all(
        pinnedIds.map((id) => newsfeedRepository.getPostById(id)),
      );
      const validPinned = rawPinned.filter((item): item is IPost => !!item);
      pinnedPosts = await enrichPosts(validPinned, actorId);
    }

    const page = await communityRepository.listContentIndex(
      groupId,
      'post',
      Math.min(limit ?? 20, 50),
      decodeCursor(cursor),
    );
    const rawPosts = await Promise.all(
      page.items.map((item: ICommunityContentIndex) =>
        newsfeedRepository.getPostById(item.contentId),
      ),
    );
    let validPosts = rawPosts.filter((item): item is IPost => !!item);

    // Filter out pinned posts from the regular list to avoid duplicates
    if (pinnedIds.length > 0) {
      validPosts = validPosts.filter((p) => !pinnedIds.includes(p.postId));
    }

    const enrichedPosts = await enrichPosts(validPosts, actorId);

    return {
      items: [...pinnedPosts, ...enrichedPosts],
      nextCursor: page.lastEvaluatedKey ? encodeCursor(page.lastEvaluatedKey) : null,
      hasMore: Boolean(page.lastEvaluatedKey),
    };
  },

  pinPost: async (actorId: string, groupId: string, postId: string): Promise<void> => {
    await communityService.assertCommunityRole(actorId, groupId, ['owner', 'admin', 'moderator']);
    const community = await requireActiveCommunity(groupId);

    const post = await newsfeedRepository.getPostById(postId);
    if (!post || post.groupId !== groupId) {
      throw new NotFoundError('Bài viết không tồn tại trong cộng đồng này');
    }

    const pinnedPostIds = community.pinnedPostIds || [];
    if (pinnedPostIds.includes(postId)) {
      return;
    }

    if (pinnedPostIds.length >= 3) {
      throw new ValidationError('Cộng đồng chỉ được ghim tối đa 3 bài viết');
    }

    const nextPinnedPostIds = [...pinnedPostIds, postId];
    await communityRepository.updateCommunity(groupId, {
      pinnedPostIds: nextPinnedPostIds,
    } as any);

    await newsfeedRepository.updatePost(postId, {
      isPinned: true,
      pinnedAt: new Date().toISOString(),
    });

    const postSnippet = post.content ? post.content.substring(0, 100) : 'Bài viết';
    await communityService.writeModerationLog(
      actorId,
      groupId,
      'pin_post',
      postId,
      'post',
      postSnippet,
    );
  },

  unpinPost: async (actorId: string, groupId: string, postId: string): Promise<void> => {
    await communityService.assertCommunityRole(actorId, groupId, ['owner', 'admin', 'moderator']);
    const community = await requireActiveCommunity(groupId);

    const pinnedPostIds = community.pinnedPostIds || [];
    if (!pinnedPostIds.includes(postId)) {
      return;
    }

    const nextPinnedPostIds = pinnedPostIds.filter((id) => id !== postId);
    await communityRepository.updateCommunity(groupId, {
      pinnedPostIds: nextPinnedPostIds,
    } as any);

    await newsfeedRepository.updatePost(postId, {
      isPinned: false,
      pinnedAt: null,
    });

    const post = await newsfeedRepository.getPostById(postId);
    const postSnippet = post?.content ? post.content.substring(0, 100) : 'Bài viết';
    await communityService.writeModerationLog(
      actorId,
      groupId,
      'unpin_post',
      postId,
      'post',
      postSnippet,
    );
  },

  reportCommunity: async (
    actorId: string,
    groupId: string,
    data: { reason: string; details?: string },
  ): Promise<void> => {
    await requireActiveCommunity(groupId);
    if (!data.reason) {
      throw new ValidationError('Lý do báo cáo không được để trống');
    }

    const reportId = uuidv4();
    const createdAt = new Date().toISOString();

    await newsfeedRepository.createReport({
      reportId,
      entityType: 'GROUP',
      entityId: groupId,
      reporterId: actorId,
      reason: data.reason,
      details: data.details,
      createdAt,
    });
  },

  listPendingPosts: async (
    actorId: string,
    groupId: string,
    limit?: number,
    cursor?: string,
  ): Promise<ICommunityPostsPage> => {
    await communityService.assertCommunityRole(actorId, groupId, ['owner', 'admin', 'moderator']);
    const page = await communityRepository.listPendingContentIndex(
      groupId,
      'post',
      Math.min(limit ?? 20, 50),
      decodeCursor(cursor),
    );
    const rawPosts = await Promise.all(
      page.items.map((item: ICommunityContentIndex) =>
        newsfeedRepository.getPostById(item.contentId),
      ),
    );
    const validPosts = rawPosts.filter((item): item is IPost => !!item);
    const enriched = await enrichPosts(validPosts, actorId);
    return {
      items: enriched,
      nextCursor: page.lastEvaluatedKey ? encodeCursor(page.lastEvaluatedKey) : null,
      hasMore: Boolean(page.lastEvaluatedKey),
    };
  },

  resolvePendingPost: async (
    actorId: string,
    groupId: string,
    postId: string,
    action: 'approve' | 'reject',
    rejectReason?: string,
  ): Promise<void> => {
    await communityService.assertCommunityRole(actorId, groupId, ['owner', 'admin', 'moderator']);
    const post = await newsfeedRepository.getPostById(postId);
    if (!post || post.groupId !== groupId) {
      throw new NotFoundError('Bài viết không tồn tại trong cộng đồng này');
    }

    const createdAtMs = new Date(post.createdAt).getTime();

    if (action === 'approve') {
      await communityRepository.deletePendingContentIndex(groupId, 'post', postId, createdAtMs);
      await communityService.addContentIndex(
        groupId,
        'post',
        postId,
        post.authorId,
        post.createdAt,
        createdAtMs,
      );

      await newsfeedRepository.updatePost(postId, {
        moderationStatus: 'approved',
        isModerated: true,
      });

      const postSnippet = post.content ? post.content.substring(0, 100) : 'Bài viết';
      await communityService.writeModerationLog(
        actorId,
        groupId,
        'approve_post',
        postId,
        'post',
        postSnippet,
      );

      const doc = {
        postId: post.postId,
        authorId: post.authorId,
        content: post.content,
        type: post.type,
        createdAt: post.createdAt,
        visibility: post.visibility,
        publicationStatus: post.publicationStatus,
        tags: post.tags,
        categories: post.categories,
        groupId: post.groupId,
        communityId: post.communityId,
      };

      try {
        const producer = getKafkaProducer();
        await producer.send({
          topic: KAFKA_TOPICS.SEARCH_INDEX,
          messages: [
            {
              key: post.postId,
              value: JSON.stringify({
                action: 'index',
                indexName: 'posts',
                documentId: post.postId,
                document: doc,
              }),
            },
          ],
        });
      } catch (error) {
        logger.error(`Emit search.index event failed for post ${post.postId} on approve:`, error);
      }

      const resolver = await userRepository.findById(actorId);
      const community = await communityRepository.getCommunityById(groupId);
      void notificationService
        .dispatch({
          type: 'post_approved',
          userId: post.authorId,
          title: 'Bài viết được duyệt',
          body: `Bài viết của bạn trong cộng đồng "${community?.name || 'Cộng đồng'}" đã được phê duyệt`,
          data: {
            route: 'post',
            id: postId,
            entityType: 'post',
            entityId: postId,
            deepLink: `/?postId=${postId}`,
            actorId,
            actorName: resolver?.displayName || undefined,
            actorAvatar: resolver?.avatar ?? null,
            extra: { groupId, postId },
          },
        })
        .catch((e) => logger.error('post_approved notification failed', e));
    } else {
      await communityRepository.deletePendingContentIndex(groupId, 'post', postId, createdAtMs);

      await newsfeedRepository.updatePost(postId, {
        moderationStatus: 'rejected',
        isModerated: true,
      });

      const postSnippet = post.content ? post.content.substring(0, 100) : 'Bài viết';
      await communityService.writeModerationLog(
        actorId,
        groupId,
        'reject_post',
        postId,
        'post',
        postSnippet,
        rejectReason,
      );

      const resolver = await userRepository.findById(actorId);
      const community = await communityRepository.getCommunityById(groupId);
      void notificationService
        .dispatch({
          type: 'post_rejected',
          userId: post.authorId,
          title: 'Bài viết bị từ chối',
          body: `Bài viết của bạn trong cộng đồng "${community?.name || 'Cộng đồng'}" đã bị từ chối.${
            rejectReason ? ` Lý do: ${rejectReason}` : ''
          }`,
          data: {
            route: 'post',
            id: postId,
            entityType: 'post',
            entityId: postId,
            deepLink: `/?postId=${postId}`,
            actorId,
            actorName: resolver?.displayName || undefined,
            actorAvatar: resolver?.avatar ?? null,
            extra: { groupId, postId, rejectReason },
          },
        })
        .catch((e) => logger.error('post_rejected notification failed', e));
    }
  },
};
