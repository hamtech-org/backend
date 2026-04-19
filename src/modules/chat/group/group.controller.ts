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
      const groupId = req.params.groupId;
      const membersBefore = await groupService.getGroupMembers(groupId);
      await groupService.deleteGroup(req.user!.userId, groupId);
      try {
        const io = getIO();
        const payload = { conversationId: groupId, groupId };
        io.to(`conv:${groupId}`).emit('group:disbanded', payload);
        io.to(`conv:${groupId}`).emit('group:deleted', { groupId });
        for (const m of membersBefore) {
          io.to(`user:${m.userId}`).emit('group:disbanded', payload);
          io.to(`user:${m.userId}`).emit('group:deleted', { groupId });
        }
      } catch {
        /* ignore */
      }
      sendSuccess(res, null, 'Giải tán nhóm thành công');
    } catch (error) {
      console.error('[deleteGroup]', error);
      next(error);
    }
  },

  leaveGroup: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = req.params.groupId;
      const userId = req.user!.userId;
      const body = (req.body ?? {}) as { newOwnerUserId?: string };
      const { memberCount } = await groupService.leaveGroup(userId, groupId, {
        newOwnerUserId: body.newOwnerUserId?.trim(),
      });
      try {
        const io = getIO();
        const leftAt = new Date().toISOString();
        const payload = { groupId, conversationId: groupId, userId, leftAt, memberCount };
        io.to(`conv:${groupId}`).emit('group:member_left', payload);
        const members = await groupService.getGroupMembers(groupId);
        for (const m of members) {
          io.to(`user:${m.userId}`).emit('group:member_left', payload);
        }
        io.to(`user:${userId}`).emit('group:member_left', payload);

        if (body.newOwnerUserId) {
          const rolePayload = {
            groupId,
            conversationId: groupId,
            userId: body.newOwnerUserId,
            role: 'owner' as const,
          };
          io.to(`conv:${groupId}`).emit('group:role_changed', rolePayload);
          for (const m of members) {
            io.to(`user:${m.userId}`).emit('group:role_changed', rolePayload);
          }
          io.to(`user:${userId}`).emit('group:role_changed', rolePayload);
        }
      } catch {
        /* ignore */
      }
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
      const { memberCount } = await groupService.removeMember(
        req.user!.userId,
        req.params.groupId,
        req.params.userId,
      );
      try {
        const io = getIO();
        const gid = req.params.groupId;
        const uid = req.params.userId;
        const payload = { groupId: gid, conversationId: gid, userId: uid, memberCount };
        io.to(`conv:${gid}`).emit('group:member_removed', payload);
        const members = await groupService.getGroupMembers(gid);
        for (const m of members) {
          io.to(`user:${m.userId}`).emit('group:member_removed', payload);
        }
        io.to(`user:${uid}`).emit('group:member_removed', payload);
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

  getGroupSettings: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const settings = await groupService.getGroupSettings(req.params.groupId);
      sendSuccess(res, settings);
    } catch (error) {
      console.error('[getGroupSettings]', error);
      next(error);
    }
  },

  updateGroupSettings: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const settings = await groupService.updateGroupSettings(
        req.user!.userId,
        req.params.groupId,
        req.body,
      );
      try {
        const io = getIO();
        const payload = { conversationId: req.params.groupId, groupSettings: settings };
        io.to(`conv:${req.params.groupId}`).emit('group:settings_updated', payload);
        const members = await groupService.getGroupMembers(req.params.groupId);
        for (const m of members) {
          io.to(`user:${m.userId}`).emit('group:settings_updated', payload);
        }
      } catch {
        /* ignore */
      }
      sendSuccess(res, settings, 'Đã cập nhật cài đặt nhóm');
    } catch (error) {
      console.error('[updateGroupSettings]', error);
      next(error);
    }
  },
};
