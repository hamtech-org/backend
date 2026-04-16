import { Request, Response, NextFunction } from 'express';
import { groupService } from './group.service.js';
import { sendSuccess } from '@/shared/utils/response.js';
import { getIO } from '@/socket/index.js';

export const groupController = {
  getGroupMembers: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const members = await groupService.getGroupMembers(req.params.groupId);
      sendSuccess(res, members);
    } catch (error) { next(error); }
  },

  updateGroup: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const group = await groupService.updateGroup(req.user!.userId, req.params.groupId, req.body);
      try {
        const io = getIO();
        io.to(`conv:${req.params.groupId}`).emit('group:updated', group);
        const members = await groupService.getGroupMembers(req.params.groupId);
        for (const m of members) {
          io.to(`user:${m.userId}`).emit('group:updated', group);
        }
      } catch { /* ignore */ }
      sendSuccess(res, group, 'Cập nhật nhóm thành công');
    } catch (error) {
      console.error('[updateGroup]', error);
      next(error);
    }
  },

  deleteGroup: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await groupService.deleteGroup(req.user!.userId, req.params.groupId);
      try {
        getIO().to(`conv:${req.params.groupId}`).emit('group:deleted', { groupId: req.params.groupId });
      } catch { /* ignore */ }
      sendSuccess(res, null, 'Giải tán nhóm thành công');
    } catch (error) {
      console.error('[deleteGroup]', error);
      next(error);
    }
  },

  leaveGroup: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await groupService.leaveGroup(req.user!.userId, req.params.groupId);
      try {
        getIO().to(`conv:${req.params.groupId}`).emit('group:member_left', {
          groupId: req.params.groupId,
          userId: req.user!.userId,
        });
      } catch { /* ignore */ }
      sendSuccess(res, null, 'Rời nhóm thành công');
    } catch (error) {
      console.error('[leaveGroup]', error);
      next(error);
    }
  },

  addMembers: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await groupService.addMembers(req.user!.userId, req.params.groupId, req.body);
      try {
        getIO().to(`conv:${req.params.groupId}`).emit('group:join_request_new', {
          groupId: req.params.groupId,
          memberIds: req.body.memberIds,
        });
      } catch { /* ignore */ }
      sendSuccess(res, null, 'Đã gửi lời mời vào nhóm');
    } catch (error) {
      console.error('[addMembers]', error);
      next(error);
    }
  },

  removeMember: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await groupService.removeMember(req.user!.userId, req.params.groupId, req.params.userId);
      try {
        getIO().to(`conv:${req.params.groupId}`).emit('group:member_removed', {
          groupId: req.params.groupId,
          userId: req.params.userId,
        });
      } catch { /* ignore */ }
      sendSuccess(res, null, 'Xóa thành viên thành công');
    } catch (error) {
      console.error('[removeMember]', error);
      next(error);
    }
  },

  changeMemberRole: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await groupService.changeMemberRole(req.user!.userId, req.params.groupId, req.params.userId, req.body.role);
      try {
        getIO().to(`conv:${req.params.groupId}`).emit('group:role_changed', {
          groupId: req.params.groupId,
          userId: req.params.userId,
          role: req.body.role,
        });
      } catch { /* ignore */ }
      sendSuccess(res, null, 'Thay đổi quyền thành công');
    } catch (error) {
      console.error('[changeMemberRole]', error);
      next(error);
    }
  },
};
