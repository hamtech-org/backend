import { adminRepository } from './admin.repository.js';
import { adminCrudService } from './admin.crud.service.js';
import type { IAnalyticsMetric, IModerationLog, MetricType } from './admin.types.js';
import { adminResourcesService } from './admin.resources.service.js';
import type { IAdminResourceSummary } from './admin.resources.types.js';
import type {
  AdminListQuery,
  AdminListResult,
  AdminUserListItem,
  AdminGroupListItem,
  AdminPostListItem,
  CreateAdminUserDto,
  UpdateAdminUserDto,
  CreateAdminGroupDto,
  UpdateAdminGroupDto,
  CreateAdminPostDto,
  UpdateAdminPostDto,
} from './admin.crud.types.js';

export const adminService = {
  // Users
  listUsers: (query: AdminListQuery): Promise<AdminListResult<AdminUserListItem>> =>
    adminCrudService.listUsers(query),
  getUser: (userId: string): Promise<AdminUserListItem> => adminCrudService.getUser(userId),
  createUser: (adminId: string, data: CreateAdminUserDto): Promise<AdminUserListItem> =>
    adminCrudService.createUser(adminId, data),
  updateUser: (
    adminId: string,
    userId: string,
    data: UpdateAdminUserDto,
  ): Promise<AdminUserListItem> => adminCrudService.updateUser(adminId, userId, data),
  updateUserRole: (
    adminId: string,
    userId: string,
    role: 'admin' | 'user',
  ): Promise<AdminUserListItem> => adminCrudService.updateUserRole(adminId, userId, role),
  deleteUser: (adminId: string, userId: string): Promise<void> =>
    adminCrudService.deleteUser(adminId, userId),

  // Groups
  listGroups: (query: AdminListQuery): Promise<AdminListResult<AdminGroupListItem>> =>
    adminCrudService.listGroups(query),
  getGroup: (groupId: string): Promise<AdminGroupListItem> => adminCrudService.getGroup(groupId),
  createGroup: (adminId: string, data: CreateAdminGroupDto): Promise<AdminGroupListItem> =>
    adminCrudService.createGroup(adminId, data),
  updateGroup: (
    adminId: string,
    groupId: string,
    data: UpdateAdminGroupDto,
  ): Promise<AdminGroupListItem> => adminCrudService.updateGroup(adminId, groupId, data),
  deleteGroup: (adminId: string, groupId: string): Promise<void> =>
    adminCrudService.deleteGroup(adminId, groupId),

  // Posts
  listPosts: (query: AdminListQuery): Promise<AdminListResult<AdminPostListItem>> =>
    adminCrudService.listPosts(query),
  getPost: (postId: string): Promise<AdminPostListItem> => adminCrudService.getPost(postId),
  createPost: (adminId: string, data: CreateAdminPostDto): Promise<AdminPostListItem> =>
    adminCrudService.createPost(adminId, data),
  updatePost: (
    adminId: string,
    postId: string,
    data: UpdateAdminPostDto,
  ): Promise<AdminPostListItem> => adminCrudService.updatePost(adminId, postId, data),
  deletePost: (adminId: string, postId: string): Promise<void> =>
    adminCrudService.deletePost(adminId, postId),

  getAnalytics: async (
    metricType: MetricType,
    from?: string,
    to?: string,
  ): Promise<IAnalyticsMetric[]> => {
    return adminRepository.getAnalytics(metricType, from, to);
  },

  getResourceSummary: async (forceRefresh = false): Promise<IAdminResourceSummary> =>
    adminResourcesService.getSummary(forceRefresh),

  getModerationLogs: async (adminId?: string): Promise<IModerationLog[]> => {
    return adminRepository.getModerationLogs(adminId);
  },
};
