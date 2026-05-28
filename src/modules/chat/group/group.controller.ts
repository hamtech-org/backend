import { Request, Response, NextFunction } from 'express';
import { groupService } from './group.service.js';
import { sendSuccess } from '@/shared/utils/response.js';
import { getIO } from '@/socket/index.js';
import {
  emitToConversationAndMembers,
  forceUserLeaveConversationRoom,
} from '../shared/chat.broadcast.js';
import { syncAssignToAllTasksAndNotify } from '../task/task-membership-sync.js';
import { memberChangePayloadExtras } from '../shared/group-avatar.util.js';

export const groupController = {
  getGroupMembers: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const members = await groupService.getGroupMembers(req.params.groupId);
      sendSuccess(res, members);
    } catch (error) {
      next(error);
    }
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
      } catch {
        /* ignore */
      }
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
      await syncAssignToAllTasksAndNotify(groupId);
      try {
        const io = getIO();
        const leftAt = new Date().toISOString();
        const avatarExtras = await memberChangePayloadExtras(groupId);
        const payload = {
          groupId,
          conversationId: groupId,
          userId,
          leftAt,
          memberCount,
          ...avatarExtras,
        };
        const profilePayload = { groupId, conversationId: groupId, memberCount, ...avatarExtras };
        io.to(`conv:${groupId}`).emit('group:member_left', payload);
        io.to(`conv:${groupId}`).emit('group:updated', profilePayload);
        const members = await groupService.getGroupMembers(groupId);
        for (const m of members) {
          io.to(`user:${m.userId}`).emit('group:member_left', payload);
          io.to(`user:${m.userId}`).emit('group:updated', profilePayload);
        }
        io.to(`user:${userId}`).emit('group:member_left', payload);
        io.to(`user:${userId}`).emit('group:updated', profilePayload);

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
      sendSuccess(res, { memberCount }, 'Rời nhóm thành công');
    } catch (error) {
      console.error('[leaveGroup]', error);
      next(error);
    }
  },

  addMembers: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const gid = req.params.groupId;
      const { memberCount, autoJoinedUserIds } = await groupService.addMembers(
        req.user!.userId,
        gid,
        req.body,
      );
      try {
        const io = getIO();
        if (autoJoinedUserIds.length > 0) {
          const joinedAt = new Date().toISOString();
          const avatarExtras = await memberChangePayloadExtras(gid);
          for (const uid of autoJoinedUserIds) {
            const joinedPayload = {
              groupId: gid,
              conversationId: gid,
              userId: uid,
              memberCount,
              joinedAt,
              ...avatarExtras,
            };
            io.to(`conv:${gid}`).emit('group:member_joined', joinedPayload);
            const members = await groupService.getGroupMembers(gid);
            for (const m of members) {
              io.to(`user:${m.userId}`).emit('group:member_joined', joinedPayload);
            }
            io.to(`user:${uid}`).emit('group:member_joined', joinedPayload);
          }
          await emitToConversationAndMembers(gid, 'group:members_added', {
            groupId: gid,
            conversationId: gid,
            memberIds: autoJoinedUserIds,
            memberCount,
            ...avatarExtras,
          });
          const profilePayload = {
            groupId: gid,
            conversationId: gid,
            memberCount,
            ...avatarExtras,
          };
          io.to(`conv:${gid}`).emit('group:updated', profilePayload);
          const membersAfter = await groupService.getGroupMembers(gid);
          for (const m of membersAfter) {
            io.to(`user:${m.userId}`).emit('group:updated', profilePayload);
          }
        } else {
          await emitToConversationAndMembers(gid, 'group:join_request_new', {
            groupId: gid,
            memberIds: req.body.memberIds,
            memberCount,
          });
        }
      } catch {
        /* ignore */
      }
      const message =
        autoJoinedUserIds.length > 0 ? 'Đã thêm thành viên vào nhóm' : 'Đã gửi lời mời vào nhóm';
      sendSuccess(res, null, message);
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
      const gid = req.params.groupId;
      await syncAssignToAllTasksAndNotify(gid);
      try {
        const io = getIO();
        const uid = req.params.userId;
        const avatarExtras = await memberChangePayloadExtras(gid);
        const payload = {
          groupId: gid,
          conversationId: gid,
          userId: uid,
          memberCount,
          ...avatarExtras,
        };
        const profilePayload = { groupId: gid, conversationId: gid, memberCount, ...avatarExtras };
        await forceUserLeaveConversationRoom(gid, uid);
        io.to(`conv:${gid}`).emit('group:member_removed', payload);
        io.to(`conv:${gid}`).emit('group:updated', profilePayload);
        const members = await groupService.getGroupMembers(gid);
        for (const m of members) {
          io.to(`user:${m.userId}`).emit('group:member_removed', payload);
          io.to(`user:${m.userId}`).emit('group:updated', profilePayload);
        }
        io.to(`user:${uid}`).emit('group:member_removed', payload);
        io.to(`user:${uid}`).emit('group:updated', profilePayload);
        io.to(`user:${uid}`).emit('group:membership_revoked', payload);
      } catch {
        /* ignore */
      }
      sendSuccess(res, { memberCount }, 'Xóa thành viên thành công');
    } catch (error) {
      console.error('[removeMember]', error);
      next(error);
    }
  },

  changeMemberRole: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await groupService.changeMemberRole(
        req.user!.userId,
        req.params.groupId,
        req.params.userId,
        req.body.role,
      );
      try {
        const rolePayload = {
          groupId: req.params.groupId,
          conversationId: req.params.groupId,
          userId: req.params.userId,
          role: req.body.role,
        };
        const io = getIO();
        io.to(`conv:${req.params.groupId}`).emit('group:role_changed', rolePayload);
        const members = await groupService.getGroupMembers(req.params.groupId);
        for (const m of members) {
          io.to(`user:${m.userId}`).emit('group:role_changed', rolePayload);
        }
      } catch {
        /* ignore */
      }
      sendSuccess(res, null, 'Thay đổi quyền thành công');
    } catch (error) {
      console.error('[changeMemberRole]', error);
      next(error);
    }
  },

  transferGroupOwner: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await groupService.transferGroupOwner(
        req.user!.userId,
        req.params.groupId,
        req.body.newOwnerUserId,
        req.body.currentOwnerNewRole,
      );
      try {
        const io = getIO();
        const members = await groupService.getGroupMembers(req.params.groupId);
        const gid = req.params.groupId;
        const profilePayload = {
          groupId: gid,
          conversationId: gid,
          leaderId: result.newOwnerUserId,
        };
        io.to(`conv:${gid}`).emit('group:updated', profilePayload);
        for (const change of result.roleChanges) {
          const rolePayload = {
            groupId: gid,
            conversationId: gid,
            userId: change.userId,
            role: change.role,
          };
          io.to(`conv:${gid}`).emit('group:role_changed', rolePayload);
          for (const m of members) {
            io.to(`user:${m.userId}`).emit('group:role_changed', rolePayload);
          }
        }
        for (const m of members) {
          io.to(`user:${m.userId}`).emit('group:updated', profilePayload);
        }
      } catch {
        /* ignore */
      }
      sendSuccess(res, result, 'Chuyển quyền trưởng nhóm thành công');
    } catch (error) {
      console.error('[transferGroupOwner]', error);
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
