import { Request, Response, NextFunction } from 'express';
import { sendCreated, sendSuccess } from '@/shared/utils/response.js';
import { communityService } from './community.service.js';
import type {
  ICreateCommunityDto,
  IJoinCommunityDto,
  IListCommunitiesQuery,
  IResolveJoinRequestDto,
  ITransferOwnerDto,
  IUpdateCommunityDto,
  IUpdateMemberRoleDto,
} from './community.types.js';

export const communityController = {
  list: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const page = await communityService.listCommunities(
        req.user!.userId,
        req.query as unknown as IListCommunitiesQuery,
      );
      sendSuccess(res, page);
    } catch (error) {
      next(error);
    }
  },

  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const community = await communityService.createCommunity(
        req.user!.userId,
        req.body as ICreateCommunityDto,
      );
      sendCreated(res, community, 'Tạo cộng đồng thành công');
    } catch (error) {
      next(error);
    }
  },

  get: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const community = await communityService.getCommunity(req.user!.userId, req.params.groupId);
      sendSuccess(res, community);
    } catch (error) {
      next(error);
    }
  },

  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const community = await communityService.updateCommunity(
        req.user!.userId,
        req.params.groupId,
        req.body as IUpdateCommunityDto,
      );
      sendSuccess(res, community, 'Cập nhật cộng đồng thành công');
    } catch (error) {
      next(error);
    }
  },

  archive: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await communityService.archiveCommunity(req.user!.userId, req.params.groupId);
      sendSuccess(res, null, 'Archive cộng đồng thành công');
    } catch (error) {
      next(error);
    }
  },

  join: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await communityService.joinCommunity(
        req.user!.userId,
        req.params.groupId,
        req.body as IJoinCommunityDto,
      );
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  },

  leave: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await communityService.leaveCommunity(req.user!.userId, req.params.groupId);
      sendSuccess(res, null, 'Rời cộng đồng thành công');
    } catch (error) {
      next(error);
    }
  },

  members: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const members = await communityService.listMembers(req.user!.userId, req.params.groupId);
      sendSuccess(res, members);
    } catch (error) {
      next(error);
    }
  },

  requests: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const requests = await communityService.listPendingRequests(
        req.user!.userId,
        req.params.groupId,
      );
      sendSuccess(res, requests);
    } catch (error) {
      next(error);
    }
  },

  resolveRequest: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await communityService.resolveJoinRequest(
        req.user!.userId,
        req.params.groupId,
        req.params.userId,
        req.body as IResolveJoinRequestDto,
      );
      sendSuccess(res, null, 'Xử lý yêu cầu thành công');
    } catch (error) {
      next(error);
    }
  },

  removeMember: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await communityService.removeMember(req.user!.userId, req.params.groupId, req.params.userId);
      sendSuccess(res, null, 'Xóa thành viên thành công');
    } catch (error) {
      next(error);
    }
  },

  updateMemberRole: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await communityService.updateMemberRole(
        req.user!.userId,
        req.params.groupId,
        req.params.userId,
        req.body as IUpdateMemberRoleDto,
      );
      sendSuccess(res, null, 'Cập nhật vai trò thành công');
    } catch (error) {
      next(error);
    }
  },

  transferOwner: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await communityService.transferOwner(
        req.user!.userId,
        req.params.groupId,
        req.body as ITransferOwnerDto,
      );
      sendSuccess(res, null, 'Chuyển quyền owner thành công');
    } catch (error) {
      next(error);
    }
  },

  posts: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const page = await communityService.listCommunityPosts(
        req.user!.userId,
        req.params.groupId,
        req.query.limit ? Number(req.query.limit) : undefined,
        typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
      );
      sendSuccess(res, page);
    } catch (error) {
      next(error);
    }
  },

  pinPost: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await communityService.pinPost(req.user!.userId, req.params.groupId, req.params.postId);
      sendSuccess(res, null, 'Ghim bài viết thành công');
    } catch (error) {
      next(error);
    }
  },

  unpinPost: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await communityService.unpinPost(req.user!.userId, req.params.groupId, req.params.postId);
      sendSuccess(res, null, 'Bỏ ghim bài viết thành công');
    } catch (error) {
      next(error);
    }
  },

  report: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const report = await communityService.reportEntity(
        req.user!.userId,
        req.params.groupId,
        req.body,
      );
      sendCreated(res, report, 'Gửi báo cáo thành công');
    } catch (error) {
      next(error);
    }
  },

  listPendingPosts: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const page = await communityService.listPendingPosts(
        req.user!.userId,
        req.params.groupId,
        req.query.limit ? Number(req.query.limit) : undefined,
        typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
      );
      sendSuccess(res, page);
    } catch (error) {
      next(error);
    }
  },

  resolvePendingPost: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { action, rejectReason } = req.body as {
        action: 'approve' | 'reject';
        rejectReason?: string;
      };
      await communityService.resolvePendingPost(
        req.user!.userId,
        req.params.groupId,
        req.params.postId,
        action,
        rejectReason,
      );
      sendSuccess(
        res,
        null,
        action === 'approve' ? 'Duyệt bài viết thành công' : 'Từ chối bài viết thành công',
      );
    } catch (error) {
      next(error);
    }
  },

  listModerationLogs: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const page = await communityService.listModerationLogs(
        req.user!.userId,
        req.params.groupId,
        req.query.limit ? Number(req.query.limit) : undefined,
        typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
      );
      sendSuccess(res, page);
    } catch (error) {
      next(error);
    }
  },

  joinChat: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const conversationId = await communityService.joinCommunityChat(
        req.params.groupId,
        req.user!.userId,
      );
      sendSuccess(res, { conversationId }, 'Gia nhập phòng chat cộng đồng thành công');
    } catch (error) {
      next(error);
    }
  },

  unlinkChat: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await communityService.unlinkChat(req.params.groupId, req.user!.userId);
      sendSuccess(res, null, 'Giải tán phòng chat thành công');
    } catch (error) {
      next(error);
    }
  },

  listReports: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const page = await communityService.listCommunityReports(
        req.user!.userId,
        req.params.groupId,
        {
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
          limit: req.query.limit ? Number(req.query.limit) : undefined,
          cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
        },
      );
      sendSuccess(res, page);
    } catch (error) {
      next(error);
    }
  },

  resolveReport: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const resolved = await communityService.resolveCommunityReport(
        req.user!.userId,
        req.params.groupId,
        req.body,
      );
      sendSuccess(res, resolved, 'Xử lý báo cáo thành công');
    } catch (error) {
      next(error);
    }
  },
};
