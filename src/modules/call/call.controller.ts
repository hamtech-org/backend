import { Request, Response, NextFunction } from 'express';
import { getIO } from '@/socket/index.js';
import { logger } from '@/shared/utils/logger.js';
import { messageService } from '@/modules/chat/message/message.service.js';
import { broadcastMessageNew } from '@/modules/chat/shared/chat.broadcast.js';
import { activeCalls, bindDirectCallPair, emitCalleeIncomingDismissed } from './call.socket.js';
import { sendSuccess } from '@/shared/utils/response.js';
import { UnauthorizedError, ValidationError } from '@/shared/utils/errors.js';

export const callController = {
  declineCall: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const {
        channelName,
        conversationId,
        callerId,
        type,
        sessionId,
        userId: bodyUserId,
      } = req.body as {
        channelName: string;
        conversationId: string;
        callerId: string;
        type: string;
        sessionId?: string;
        userId?: string;
      };

      if (!channelName || !conversationId || !callerId) {
        throw new ValidationError('Thiếu thông tin cuộc gọi bắt buộc');
      }

      // 1. Xác thực danh tính User B (Callee)
      let calleeUserId: string;
      if (req.user) {
        calleeUserId = req.user.userId;
      } else {
        // Fallback xác thực bằng sessionId + channelName khi JWT hết hạn hoàn toàn ở Killed State
        if (!sessionId) {
          throw new UnauthorizedError('Token hết hạn và không cung cấp sessionId cuộc gọi');
        }

        const call = activeCalls.get(sessionId);
        if (!call || call.channelName !== channelName) {
          throw new UnauthorizedError('Phiên cuộc gọi không tồn tại hoặc thông tin không khớp');
        }

        const resolvedUserId = bodyUserId || call.calleeId;
        if (!resolvedUserId) {
          throw new UnauthorizedError('Không tìm thấy thông tin định danh Callee');
        }

        if (call.scope === 'direct') {
          if (resolvedUserId !== call.calleeId) {
            throw new UnauthorizedError('Thông tin định danh Callee không khớp cuộc gọi');
          }
        }

        calleeUserId = resolvedUserId;
      }

      const io = getIO();

      // 2. Xử lý từ chối cuộc gọi nhóm
      if (channelName.startsWith('grp_')) {
        io.to(`user:${callerId}`).emit('call:group-member-declined', {
          declinedBy: calleeUserId,
          channelName,
          conversationId,
          sessionId,
        });
        emitCalleeIncomingDismissed(io, calleeUserId, {
          channelName,
          conversationId,
          reason: 'rejected',
          sessionId,
        });

        if (sessionId) {
          activeCalls.delete(sessionId);
        }

        logger.info(`REST Call group member declined: ${calleeUserId} channel=${channelName}`);
        sendSuccess(res, null, 'Từ chối cuộc gọi nhóm thành công');
        return;
      }

      // 3. Xử lý từ chối cuộc gọi 1-1
      io.to(`user:${callerId}`).emit('call:rejected', {
        calleeId: calleeUserId,
        channelName,
        conversationId,
        sessionId,
      });
      emitCalleeIncomingDismissed(io, calleeUserId, {
        channelName,
        conversationId,
        reason: 'rejected',
        sessionId,
      });

      if (sessionId) {
        activeCalls.delete(sessionId);
      }

      logger.info(`REST Call rejected: ${calleeUserId} on channel=${channelName}`);

      try {
        const message = await messageService.sendMessage(calleeUserId, conversationId, {
          type: 'call',
          content: JSON.stringify({
            kind: 'rejected',
            callType: type || 'audio',
            durationSec: 0,
          }),
        });
        await broadcastMessageNew(message);
      } catch (e) {
        logger.error('REST Create call log (rejected) failed:', e);
      }

      sendSuccess(res, null, 'Từ chối cuộc gọi thành công');
    } catch (error) {
      next(error);
    }
  },

  acceptCall: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const {
        channelName,
        conversationId,
        callerId,
        type,
        sessionId,
        userId: bodyUserId,
      } = req.body as {
        channelName: string;
        conversationId: string;
        callerId: string;
        type: string;
        sessionId?: string;
        userId?: string;
      };

      if (!channelName || !conversationId || !callerId) {
        throw new ValidationError('Thiếu thông tin cuộc gọi bắt buộc');
      }

      // 1. Xác thực danh tính User B (Callee)
      let calleeUserId: string;
      if (req.user) {
        calleeUserId = req.user.userId;
      } else {
        if (!sessionId) {
          throw new UnauthorizedError('Token hết hạn và không cung cấp sessionId cuộc gọi');
        }

        const call = activeCalls.get(sessionId);
        if (!call || call.channelName !== channelName) {
          throw new UnauthorizedError('Phiên cuộc gọi không tồn tại hoặc thông tin không khớp');
        }

        const resolvedUserId = bodyUserId || call.calleeId;
        if (!resolvedUserId) {
          throw new UnauthorizedError('Không tìm thấy thông tin định danh Callee');
        }

        if (call.scope === 'direct') {
          if (resolvedUserId !== call.calleeId) {
            throw new UnauthorizedError('Thông tin định danh Callee không khớp cuộc gọi');
          }
        }

        calleeUserId = resolvedUserId;
      }

      // 2. Chấp nhận cuộc gọi RTC
      if (!channelName.startsWith('grp_')) {
        bindDirectCallPair(callerId, calleeUserId, channelName);
      }

      const io = getIO();
      io.to(`user:${callerId}`).emit('call:accepted', {
        calleeId: calleeUserId,
        channelName,
        conversationId,
        type: type || 'audio',
        sessionId,
      });
      emitCalleeIncomingDismissed(io, calleeUserId, {
        channelName,
        conversationId,
        reason: 'accepted',
        sessionId,
      });

      logger.info(`REST Call accepted: ${calleeUserId} on channel=${channelName}`);
      sendSuccess(res, null, 'Chấp nhận cuộc gọi thành công');
    } catch (error) {
      next(error);
    }
  },
};
