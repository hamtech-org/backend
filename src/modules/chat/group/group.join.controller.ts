import { Request, Response, NextFunction } from 'express';
import { groupJoinService } from './group.join.service.js';
import { sendSuccess } from '@/shared/utils/response.js';
import { getIO } from '@/socket/index.js';
import { emitToConversationAndMembers } from '../shared/chat.broadcast.js';
import { groupService } from './group.service.js';

export const groupJoinController = {
  getJoinPreview: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const preview = await groupJoinService.getJoinPreview(req.params.suffix, req.user?.userId);
      sendSuccess(res, preview);
    } catch (error) {
      console.error('[getJoinPreview]', error);
      next(error);
    }
  },

  joinViaLink: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await groupJoinService.joinViaLink(req.user!.userId, req.params.suffix);
      const gid = result.conversationId;

      try {
        if (result.status === 'pending') {
          await emitToConversationAndMembers(gid, 'group:join_request_new', { groupId: gid });
        } else if (result.status === 'joined') {
          const io = getIO();
          const uid = req.user!.userId;
          const joinedPayload = {
            groupId: gid,
            conversationId: gid,
            userId: uid,
            memberCount: result.memberCount,
            joinedAt: new Date().toISOString(),
          };
          io.to(`conv:${gid}`).emit('group:member_joined', joinedPayload);
          const members = await groupService.getGroupMembers(gid);
          for (const m of members) {
            io.to(`user:${m.userId}`).emit('group:member_joined', joinedPayload);
          }
          io.to(`user:${uid}`).emit('group:request_approved', joinedPayload);
        }
      } catch {
        /* ignore */
      }

      const messages: Record<typeof result.status, string> = {
        joined: 'Đã tham gia nhóm',
        pending: 'Đã gửi yêu cầu tham gia — chờ trưởng nhóm duyệt',
        already_member: 'Bạn đã là thành viên nhóm',
      };
      sendSuccess(res, result, messages[result.status]);
    } catch (error) {
      console.error('[joinViaLink]', error);
      next(error);
    }
  },
};
