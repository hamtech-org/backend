import { adminRepository } from './admin.repository.js';
import type {
  IAnalyticsMetric, IModerateAction, IModerationLog,
  IResourceSummary, MetricType,
} from './admin.types.js';

export const adminService = {
  getGroups: async (_limit?: number): Promise<unknown[]> => {
    // TODO: Lấy danh sách tất cả groups cho admin
    return [];
  },

  moderateGroup: async (_adminId: string, _groupId: string, _action: IModerateAction): Promise<void> => {
    // TODO: Thực hiện hành động moderate group + ghi log
    void adminRepository;
    throw new Error('Chưa triển khai');
  },

  getPosts: async (_limit?: number): Promise<unknown[]> => {
    // TODO: Lấy danh sách bài viết cần moderate
    return [];
  },

  moderatePost: async (_adminId: string, _postId: string, _action: IModerateAction): Promise<void> => {
    // TODO: Thực hiện hành động moderate post + ghi log
    throw new Error('Chưa triển khai');
  },

  deletePost: async (_adminId: string, _postId: string, _reason: string): Promise<void> => {
    // TODO: Xóa bài viết vi phạm + ghi log
    throw new Error('Chưa triển khai');
  },

  getAnalytics: async (metricType: MetricType, from?: string, to?: string): Promise<IAnalyticsMetric[]> => {
    return adminRepository.getAnalytics(metricType, from, to);
  },

  getResourceSummary: async (): Promise<IResourceSummary> => {
    // TODO: Tổng hợp resource summary từ nhiều bảng
    throw new Error('Chưa triển khai');
  },

  getModerationLogs: async (adminId?: string): Promise<IModerationLog[]> => {
    return adminRepository.getModerationLogs(adminId);
  },
};
