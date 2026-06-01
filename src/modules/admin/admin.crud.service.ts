import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { authRepository } from '@/modules/auth/auth.repository.js';
import { communityRepository, padMs } from '@/modules/community/community.repository.js';
import type {
  CommunityCategory,
  CommunityJoinPolicy,
  CommunityType,
  ICommunity,
  ICommunityMember,
} from '@/modules/community/community.types.js';
import { newsfeedRepository } from '@/modules/newsfeed/newsfeed.repository.js';
import { newsfeedService } from '@/modules/newsfeed/newsfeed.service.js';
import { communityService } from '@/modules/community/community.service.js';
import type { IPost, ModerationStatus } from '@/modules/newsfeed/newsfeed.types.js';
import { userRepository } from '@/modules/user/user.repository.js';
import type { IUser } from '@/modules/user/user.types.js';
import { ConflictError, ForbiddenError, NotFoundError } from '@/shared/utils/errors.js';
import { adminCrudRepository } from './admin.crud.repository.js';
import {
  fromAdminPostStatus,
  toAdminPostStatus,
  writeModerationLog,
} from './admin.crud.helpers.js';
import type {
  AdminGroupListItem,
  AdminListQuery,
  AdminListResult,
  AdminPostListItem,
  AdminUserListItem,
  CreateAdminGroupDto,
  CreateAdminPostDto,
  CreateAdminUserDto,
  AdminGroupStatus,
  UpdateAdminGroupDto,
  UpdateAdminPostDto,
  UpdateAdminUserDto,
} from './admin.crud.types.js';

function mapUserToListItem(user: IUser): AdminUserListItem {
  return {
    userId: user.userId,
    email: user.email,
    displayName: user.displayName,
    avatar: user.avatar,
    role: user.role,
    status: user.status,
    isVerified: user.isVerified,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    ...(user.isDeleted ? { isDeleted: true } : {}),
  };
}

function matchesUserQuery(user: IUser, query?: string, role?: string): boolean {
  if (user.isDeleted) return false;
  if (role && user.role !== role) return false;
  if (!query?.trim()) return true;
  const q = query.trim().toLowerCase();
  return (
    user.displayName.toLowerCase().includes(q) ||
    user.email.toLowerCase().includes(q) ||
    user.userId.toLowerCase().includes(q)
  );
}

function mapGroupToListItem(community: ICommunity, ownerDisplayName?: string): AdminGroupListItem {
  return {
    groupId: community.groupId,
    name: community.name,
    description: community.description ?? undefined,
    avatar: community.avatar ?? undefined,
    ownerId: community.ownerId,
    ownerDisplayName,
    memberCount: community.memberCount ?? 0,
    status: community.status,
    createdAt: community.createdAt,
    updatedAt: community.updatedAt,
    isDeleted: !community.isActive || community.status === 'archived',
  };
}

function mapPostToListItem(post: IPost, authorDisplayName?: string): AdminPostListItem {
  const reactions = post.reactionsCount ?? {};
  const likes = Object.values(reactions).reduce((s, v) => s + (v ?? 0), 0);
  const title = post.content.trim().slice(0, 80) || '(Không có nội dung)';
  return {
    postId: post.postId,
    title,
    content: post.content,
    authorId: post.authorId,
    authorDisplayName,
    visibility: post.visibility,
    status: toAdminPostStatus(post.moderationStatus),
    likes,
    comments: post.commentsCount ?? 0,
    shares: post.sharesCount ?? 0,
    views: post.viewsCount ?? 0,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

function assertNotSelf(adminId: string, targetUserId: string, action: string): void {
  if (adminId === targetUserId) {
    throw new ForbiddenError(`Admin không thể ${action} chính mình`);
  }
}

function isAdminGroupStatus(status: string): status is AdminGroupStatus {
  return status === 'active' || status === 'archived';
}

function normalizeSlug(input: string): string {
  const normalized = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return normalized || `community-${Date.now()}`;
}

function isConditionalFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    String((error as { name?: string }).name) === 'TransactionCanceledException'
  );
}

function buildCommunityOwnerMember(
  groupId: string,
  ownerId: string,
  joinedAt: string,
  joinedAtMs: number,
): ICommunityMember {
  return {
    groupId,
    communityId: groupId,
    userId: ownerId,
    role: 'owner',
    status: 'active',
    joinedAt,
    joinedAtMs,
    GSI1PK: `USER#${ownerId}`,
    GSI1SK: `JOINED#${padMs(joinedAtMs)}#${groupId}`,
  };
}

export const adminCrudService = {
  listUsers: async (query: AdminListQuery): Promise<AdminListResult<AdminUserListItem>> => {
    const limit = query.limit ?? 20;
    const { items, nextCursor } = await adminCrudRepository.scanUserProfiles(
      limit,
      query.cursor,
      (u) => matchesUserQuery(u, query.query, query.role),
    );
    return {
      items: items.map(mapUserToListItem),
      nextCursor,
    };
  },

  getUser: async (userId: string): Promise<AdminUserListItem> => {
    const user = await userRepository.findById(userId);
    if (!user || user.isDeleted) throw new NotFoundError('Người dùng');
    return mapUserToListItem(user);
  },

  createUser: async (adminId: string, data: CreateAdminUserDto): Promise<AdminUserListItem> => {
    const existing = await authRepository.findUserByEmail(data.email);
    if (existing) throw new ConflictError('Email đã được sử dụng');

    const userId = uuidv4();
    const now = new Date().toISOString();
    const passwordHash = await bcrypt.hash(data.password, 10);
    const newUser: IUser = {
      userId,
      email: data.email,
      passwordHash,
      displayName: data.displayName,
      avatar: null,
      bio: null,
      phone: null,
      status: 'offline',
      role: data.role ?? 'user',
      isVerified: true,
      lastSeen: null,
      tokenVersion: 0,
      faceLoginEnabled: false,
      rekognitionFaceId: null,
      oauthProvider: 'local',
      oauthId: null,
      settings: {},
      createdAt: now,
      updatedAt: now,
    };

    await authRepository.createUser(newUser);
    await writeModerationLog(adminId, 'user', userId, 'approve', 'Admin tạo người dùng');
    return mapUserToListItem(newUser);
  },

  updateUser: async (
    adminId: string,
    userId: string,
    data: UpdateAdminUserDto,
  ): Promise<AdminUserListItem> => {
    const user = await userRepository.findById(userId);
    if (!user || user.isDeleted) throw new NotFoundError('Người dùng');

    if (data.email && data.email !== user.email) {
      const dup = await authRepository.findUserByEmail(data.email);
      if (dup && dup.userId !== userId) throw new ConflictError('Email đã được sử dụng');
    }

    await adminCrudRepository.updateUserFields(userId, {
      ...(data.displayName !== undefined ? { displayName: data.displayName } : {}),
      ...(data.email !== undefined ? { email: data.email } : {}),
      ...(data.avatar !== undefined ? { avatar: data.avatar } : {}),
    });

    await writeModerationLog(adminId, 'user', userId, 'approve', 'Admin cập nhật người dùng');
    return adminCrudService.getUser(userId);
  },

  updateUserRole: async (
    adminId: string,
    userId: string,
    role: 'admin' | 'user',
  ): Promise<AdminUserListItem> => {
    assertNotSelf(adminId, userId, 'thay đổi quyền');
    const user = await userRepository.findById(userId);
    if (!user || user.isDeleted) throw new NotFoundError('Người dùng');

    await adminCrudRepository.updateUserRole(userId, role);
    await writeModerationLog(
      adminId,
      'user',
      userId,
      role === 'admin' ? 'approve' : 'warn',
      `Admin gán role=${role}`,
    );
    return adminCrudService.getUser(userId);
  },

  deleteUser: async (adminId: string, userId: string): Promise<void> => {
    assertNotSelf(adminId, userId, 'xóa');
    const user = await userRepository.findById(userId);
    if (!user || user.isDeleted) throw new NotFoundError('Người dùng');

    const tombstoneEmail = `deleted+${userId}@hamtech.local`;
    await adminCrudRepository.softDeleteUser(
      userId,
      tombstoneEmail,
      `[Đã xóa] ${user.displayName}`,
    );
    await authRepository.incrementTokenVersion(userId);
    await authRepository.deleteAllUserSessions(userId);
    await writeModerationLog(adminId, 'user', userId, 'delete', 'Admin xóa người dùng (soft)');
  },

  listGroups: async (query: AdminListQuery): Promise<AdminListResult<AdminGroupListItem>> => {
    const limit = query.limit ?? 20;
    const { items, nextCursor } = await adminCrudRepository.scanCommunityMetas(limit, query.cursor);

    let filtered = items;
    if (query.status && isAdminGroupStatus(query.status)) {
      filtered = filtered.filter((g) => g.status === query.status);
    }
    if (query.query?.trim()) {
      const q = query.query.trim().toLowerCase();
      filtered = filtered.filter(
        (g) =>
          g.name.toLowerCase().includes(q) ||
          g.groupId.toLowerCase().includes(q) ||
          g.slug.toLowerCase().includes(q) ||
          (g.description ?? '').toLowerCase().includes(q),
      );
    }

    const ownerIds = [...new Set(filtered.map((g) => g.ownerId))];
    const owners = await userRepository.findByIds(ownerIds);
    const ownerMap = new Map(owners.map((o) => [o.userId, o.displayName]));

    return {
      items: filtered.map((g) => mapGroupToListItem(g, ownerMap.get(g.ownerId))),
      nextCursor,
    };
  },

  getGroup: async (groupId: string): Promise<AdminGroupListItem> => {
    const community = await adminCrudRepository.getCommunityMeta(groupId);
    if (!community) throw new NotFoundError('Cộng đồng');
    const [owner] = await userRepository.findByIds([community.ownerId]);
    return mapGroupToListItem(community, owner?.displayName);
  },

  createGroup: async (adminId: string, data: CreateAdminGroupDto): Promise<AdminGroupListItem> => {
    const owner = await userRepository.findById(data.ownerId);
    if (!owner || owner.isDeleted) throw new NotFoundError('Chủ sở hữu');

    const now = new Date();
    const createdAt = now.toISOString();
    const createdAtMs = now.getTime();
    const groupId = uuidv4();
    const category: CommunityCategory = data.category ?? 'general';
    const type: CommunityType = data.type ?? 'public';
    const joinPolicy: CommunityJoinPolicy =
      data.joinPolicy ?? (type === 'private' ? 'approval' : 'open');
    const community: ICommunity = {
      groupId,
      communityId: groupId,
      name: data.name.trim(),
      slug: normalizeSlug(data.slug ?? data.name),
      description: data.description?.trim() || null,
      avatar: null,
      coverUrl: null,
      category,
      type,
      joinPolicy,
      creatorId: data.ownerId,
      ownerId: data.ownerId,
      memberCount: 1,
      postCount: 0,
      popularityScore: 0,
      isApprovalRequired: joinPolicy === 'approval',
      isPostApprovalRequired: false,
      conversationId: null,
      chatEnabled: true,
      isActive: true,
      status: 'active',
      createdAt,
      createdAtMs,
      updatedAt: createdAt,
    };

    try {
      await communityRepository.createCommunity(
        community,
        buildCommunityOwnerMember(groupId, data.ownerId, createdAt, createdAtMs),
      );
    } catch (error) {
      if (isConditionalFailure(error)) throw new ConflictError('Slug cộng đồng đã tồn tại');
      throw error;
    }

    await writeModerationLog(adminId, 'group', groupId, 'approve', 'Admin tạo cộng đồng');
    return mapGroupToListItem(community, owner.displayName);
  },

  updateGroup: async (
    adminId: string,
    groupId: string,
    data: UpdateAdminGroupDto,
  ): Promise<AdminGroupListItem> => {
    const community = await adminCrudRepository.getCommunityMeta(groupId);
    if (!community) throw new NotFoundError('Cộng đồng');

    const updates: Parameters<typeof adminCrudRepository.updateCommunityFields>[1] = {};
    if (data.name !== undefined) updates.name = data.name.trim();
    if (data.description !== undefined) updates.description = data.description.trim() || null;
    if (data.avatar !== undefined) updates.avatar = data.avatar;

    if (data.status === 'archived') {
      if (Object.keys(updates).length > 0) {
        await adminCrudRepository.updateCommunityFields(groupId, updates);
      }
      await communityService.archiveCommunity(adminId, groupId, true);
    } else {
      const removeFields: Array<'deletedAt' | 'deletedBy'> = [];
      if (data.status === 'active') {
        updates.status = 'active';
        updates.isActive = true;
        removeFields.push('deletedAt', 'deletedBy');
      }
      if (Object.keys(updates).length > 0 || removeFields.length > 0) {
        await adminCrudRepository.updateCommunityFields(groupId, updates, removeFields);
      }
    }

    await writeModerationLog(adminId, 'group', groupId, 'approve', 'Admin cập nhật cộng đồng');
    return adminCrudService.getGroup(groupId);
  },

  deleteGroup: async (adminId: string, groupId: string): Promise<void> => {
    const community = await adminCrudRepository.getCommunityMeta(groupId);
    if (!community) throw new NotFoundError('Cộng đồng');

    await communityService.archiveCommunity(adminId, groupId, true);
    await writeModerationLog(adminId, 'group', groupId, 'delete', 'Admin lưu trữ cộng đồng');
  },

  listPosts: async (query: AdminListQuery): Promise<AdminListResult<AdminPostListItem>> => {
    const limit = query.limit ?? 20;
    const { items, nextCursor } = await adminCrudRepository.scanPostMetas(limit, query.cursor);

    let filtered = items;
    if (query.status) {
      filtered = filtered.filter((p) => toAdminPostStatus(p.moderationStatus) === query.status);
    }
    if (query.query?.trim()) {
      const q = query.query.trim().toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.content.toLowerCase().includes(q) ||
          p.postId.toLowerCase().includes(q) ||
          p.authorId.toLowerCase().includes(q),
      );
    }

    const authorIds = [...new Set(filtered.map((p) => p.authorId))];
    const authors = await userRepository.findByIds(authorIds);
    const authorMap = new Map(authors.map((a) => [a.userId, a.displayName]));

    return {
      items: filtered.map((p) => mapPostToListItem(p, authorMap.get(p.authorId))),
      nextCursor,
    };
  },

  getPost: async (postId: string): Promise<AdminPostListItem> => {
    const post = await newsfeedRepository.getPostById(postId);
    if (!post) throw new NotFoundError('Bài viết');
    const [author] = await userRepository.findByIds([post.authorId]);
    return mapPostToListItem(post, author?.displayName);
  },

  createPost: async (adminId: string, data: CreateAdminPostDto): Promise<AdminPostListItem> => {
    const moderationStatus: ModerationStatus = data.status
      ? fromAdminPostStatus(data.status)
      : 'approved';

    const post = await newsfeedService.createPost(adminId, {
      content: data.content,
      type: 'text',
      visibility: data.visibility ?? 'public',
      publicationStatus: 'published',
      mediaUrls: [],
    });

    if (moderationStatus !== 'approved') {
      await newsfeedRepository.updatePost(post.postId, {
        moderationStatus,
        isModerated: moderationStatus !== 'pending',
      });
    }

    await writeModerationLog(adminId, 'post', post.postId, 'approve', 'Admin tạo bài viết');
    return adminCrudService.getPost(post.postId);
  },

  updatePost: async (
    adminId: string,
    postId: string,
    data: UpdateAdminPostDto,
  ): Promise<AdminPostListItem> => {
    const existing = await newsfeedRepository.getPostById(postId);
    if (!existing) throw new NotFoundError('Bài viết');

    const updates: Partial<IPost> = {};
    if (data.content !== undefined) updates.content = data.content;
    if (data.visibility !== undefined) updates.visibility = data.visibility;
    if (data.status !== undefined) {
      updates.moderationStatus = fromAdminPostStatus(data.status);
      updates.isModerated = true;
    }

    if (Object.keys(updates).length > 0) {
      await newsfeedRepository.updatePost(postId, updates);
    }

    await writeModerationLog(adminId, 'post', postId, 'approve', 'Admin cập nhật bài viết');
    return adminCrudService.getPost(postId);
  },

  deletePost: async (adminId: string, postId: string): Promise<void> => {
    const existing = await newsfeedRepository.getPostById(postId);
    if (!existing) throw new NotFoundError('Bài viết');

    await newsfeedRepository.deleteCommentsByPostId(postId);
    await newsfeedRepository.deleteReactionsByPostId(postId);
    await newsfeedRepository.deletePost(postId);

    await writeModerationLog(adminId, 'post', postId, 'delete', 'Admin xóa bài viết');
  },
};
