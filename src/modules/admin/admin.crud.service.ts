import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { authRepository } from '@/modules/auth/auth.repository.js';
import { conversationRepository } from '@/modules/chat/conversation/conversation.repository.js';
import { conversationService } from '@/modules/chat/conversation/conversation.service.js';
import { mergeGroupSettings } from '@/modules/chat/group/group.service.js';
import type { IConversation } from '@/modules/chat/shared/chat.types.js';
import { createAndBroadcastSystemMessage } from '@/modules/chat/shared/system-message.factory.js';
import { newsfeedRepository } from '@/modules/newsfeed/newsfeed.repository.js';
import { newsfeedService } from '@/modules/newsfeed/newsfeed.service.js';
import type { IPost, ModerationStatus } from '@/modules/newsfeed/newsfeed.types.js';
import { userRepository } from '@/modules/user/user.repository.js';
import type { IUser } from '@/modules/user/user.types.js';
import { ConflictError, ForbiddenError, NotFoundError } from '@/shared/utils/errors.js';
import { getIO } from '@/socket/index.js';
import { adminCrudRepository } from './admin.crud.repository.js';
import {
  fromAdminPostStatus,
  resolveGroupStatus,
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
  UpdateAdminGroupDto,
  UpdateAdminPostDto,
  UpdateAdminUserDto,
} from './admin.crud.types.js';

const sysMsgDeps = {
  createMessage: conversationRepository.createMessage,
  updateConversationLastMessage: conversationRepository.updateConversationLastMessage,
};

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

function mapGroupToListItem(conv: IConversation, ownerDisplayName?: string): AdminGroupListItem {
  return {
    groupId: conv.conversationId,
    name: conv.name ?? 'Nhóm',
    description: conv.description,
    avatar: conv.avatar,
    ownerId: conv.leaderId ?? conv.creatorId,
    ownerDisplayName,
    memberCount: conv.memberCount ?? 0,
    status: resolveGroupStatus(conv),
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    isDeleted: conv.isDeleted === true,
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
    const { items, nextCursor } = await adminCrudRepository.scanGroupMetas(limit, query.cursor);

    let filtered = items;
    if (query.status) {
      filtered = filtered.filter((g) => resolveGroupStatus(g) === query.status);
    }
    if (query.query?.trim()) {
      const q = query.query.trim().toLowerCase();
      filtered = filtered.filter(
        (g) =>
          (g.name ?? '').toLowerCase().includes(q) ||
          g.conversationId.toLowerCase().includes(q) ||
          (g.description ?? '').toLowerCase().includes(q),
      );
    }

    const ownerIds = [...new Set(filtered.map((g) => g.leaderId ?? g.creatorId))];
    const owners = await userRepository.findByIds(ownerIds);
    const ownerMap = new Map(owners.map((o) => [o.userId, o.displayName]));

    return {
      items: filtered.map((g) => mapGroupToListItem(g, ownerMap.get(g.leaderId ?? g.creatorId))),
      nextCursor,
    };
  },

  getGroup: async (groupId: string): Promise<AdminGroupListItem> => {
    const conv = await conversationRepository.getConversationById(groupId);
    if (!conv || conv.type !== 'group') throw new NotFoundError('Nhóm');
    const ownerId = conv.leaderId ?? conv.creatorId;
    const [owner] = await userRepository.findByIds([ownerId]);
    return mapGroupToListItem(conv, owner?.displayName);
  },

  createGroup: async (adminId: string, data: CreateAdminGroupDto): Promise<AdminGroupListItem> => {
    const owner = await userRepository.findById(data.ownerId);
    if (!owner || owner.isDeleted) throw new NotFoundError('Chủ nhóm');

    const extraMembers = (data.memberIds ?? []).filter((id) => id !== data.ownerId);
    const conv = await conversationService.createConversation(data.ownerId, {
      type: 'group',
      name: data.name,
      memberIds: extraMembers,
    });

    if (data.description) {
      await conversationRepository.updateConversation(conv.conversationId, {
        description: data.description,
      });
    }

    await writeModerationLog(adminId, 'group', conv.conversationId, 'approve', 'Admin tạo nhóm');
    return adminCrudService.getGroup(conv.conversationId);
  },

  updateGroup: async (
    adminId: string,
    groupId: string,
    data: UpdateAdminGroupDto,
  ): Promise<AdminGroupListItem> => {
    const conv = await conversationRepository.getConversationById(groupId);
    if (!conv || conv.type !== 'group') throw new NotFoundError('Nhóm');

    const updates: Partial<IConversation> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.avatar !== undefined) updates.avatar = data.avatar;

    if (data.status !== undefined) {
      const gs = mergeGroupSettings(conv.groupSettings);
      gs.adminStatus = data.status;
      updates.groupSettings = gs;
      updates.groupStatus = data.status;
    }

    if (Object.keys(updates).length > 0) {
      await conversationRepository.updateConversation(groupId, updates);
    }

    await writeModerationLog(adminId, 'group', groupId, 'approve', 'Admin cập nhật nhóm');
    return adminCrudService.getGroup(groupId);
  },

  deleteGroup: async (adminId: string, groupId: string): Promise<void> => {
    const conversation = await conversationRepository.getConversationById(groupId);
    if (!conversation || conversation.type !== 'group') throw new NotFoundError('Nhóm');

    const members = await conversationRepository.getConversationMembers(groupId);

    try {
      await createAndBroadcastSystemMessage(
        {
          conversationId: groupId,
          senderId: adminId,
          content: 'Nhóm đã được giải tán bởi quản trị viên',
        },
        sysMsgDeps,
      );
    } catch {
      /* best-effort */
    }

    await conversationRepository.updateConversation(groupId, {
      name: `[ĐÃ GIẢI TÁN] ${conversation.name ?? 'Nhóm'}`,
      isDeleted: true,
      memberCount: 0,
    });

    await Promise.all(members.map((m) => conversationRepository.removeMember(groupId, m.userId)));

    try {
      const io = getIO();
      const payload = { conversationId: groupId, groupId };
      io.to(`conv:${groupId}`).emit('group:disbanded', payload);
      for (const m of members) {
        io.to(`user:${m.userId}`).emit('group:disbanded', payload);
      }
    } catch {
      /* ignore socket */
    }

    await writeModerationLog(adminId, 'group', groupId, 'delete', 'Admin giải tán nhóm');
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
