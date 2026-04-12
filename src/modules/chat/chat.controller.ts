import { Request, Response, NextFunction } from 'express';
import { chatService } from './chat.service.js';
import { sendSuccess, sendCreated } from '@/shared/utils/response.js';
import { getIO } from '@/socket/index.js';
import { broadcastMessageNew } from './chat.broadcast.js';

export const chatController = {
  // ─── Conversations / Groups ────────────────────────────────────────────────────

  getConversations: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const conversations = await chatService.getConversations(req.user!.userId);
      sendSuccess(res, conversations);
    } catch (error) { next(error); }
  },

  createConversation: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const conversation = await chatService.createConversation(req.user!.userId, req.body);
      sendCreated(res, conversation);
    } catch (error) { next(error); }
  },

  getConversation: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const conversation = await chatService.getConversationById(
        req.params.conversationId,
        req.user!.userId,
      );
      sendSuccess(res, conversation);
    } catch (error) { next(error); }
  },

  getMessages: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const messages = await chatService.getMessages(req.params.conversationId, limit);
      sendSuccess(res, messages);
    } catch (error) { next(error); }
  },

  sendMessage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const message = await chatService.sendMessage(
        req.user!.userId,
        req.params.conversationId,
        req.body,
      );
      try {
        await broadcastMessageNew(message);
      } catch { /* socket chưa khởi tạo hoặc lỗi broadcast */ }
      sendCreated(res, message);
    } catch (error) { next(error); }
  },

  editMessage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { content, conversationId, createdAt } = req.body as {
        content: string;
        conversationId: string;
        createdAt: string;
      };
      await chatService.editMessage(
        req.params.messageId,
        content,
        req.user!.userId,
        conversationId,
        createdAt,
      );
      try {
        getIO().to(`conv:${conversationId}`).emit('message:edited', {
          messageId: req.params.messageId,
          conversationId,
          content,
        });
      } catch { /* socket chưa khởi tạo */ }
      sendSuccess(res, null, 'Chỉnh sửa thành công');
    } catch (error) { next(error); }
  },

  deleteMessage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { conversationId, createdAt } = req.body as { conversationId: string; createdAt: string };
      await chatService.deleteMessage(
        req.params.messageId,
        req.user!.userId,
        conversationId,
        createdAt,
      );
      try {
        getIO().to(`conv:${conversationId}`).emit('message:deleted', {
          messageId: req.params.messageId,
          conversationId,
        });
        getIO().to(`conv:${conversationId}`).emit('message:pin_updated', {
          messageId: req.params.messageId,
          conversationId,
          isPinned: false,
        });
      } catch { /* socket chưa khởi tạo */ }
      sendSuccess(res, null, 'Xóa thành công');
    } catch (error) { next(error); }
  },

  recallMessage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { conversationId, createdAt } = req.body as { conversationId: string; createdAt: string };
      await chatService.recallMessage(
        req.params.messageId,
        req.user!.userId,
        conversationId,
        createdAt,
      );
      try {
        getIO().to(`conv:${conversationId}`).emit('message:recall', {
          messageId: req.params.messageId,
          conversationId,
        });
        getIO().to(`conv:${conversationId}`).emit('message:pin_updated', {
          messageId: req.params.messageId,
          conversationId,
          isPinned: false,
        });
      } catch { /* socket chưa khởi tạo */ }
      sendSuccess(res, null, 'Thu hồi thành công');
    } catch (error) { next(error); }
  },

  markAsRead: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { messageId } = req.body as { messageId: string };
      await chatService.markAsRead(req.params.conversationId, req.user!.userId, messageId);
      sendSuccess(res, null, 'Đã đánh dấu đã đọc');
    } catch (error) { next(error); }
  },

  pinMessage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { conversationId, createdAt } = req.body as { conversationId: string; createdAt: string };
      await chatService.pinMessage(req.params.messageId, conversationId, createdAt);
      try {
        getIO().to(`conv:${conversationId}`).emit('message:pin_updated', {
          messageId: req.params.messageId,
          conversationId,
          isPinned: true,
        });
      } catch { /* socket chưa khởi tạo */ }
      sendSuccess(res, null, 'Đã ghim tin nhắn');
    } catch (error) { next(error); }
  },

  unpinMessage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { conversationId, createdAt } = req.body as { conversationId: string; createdAt: string };
      await chatService.unpinMessage(req.params.messageId, conversationId, createdAt);
      try {
        getIO().to(`conv:${conversationId}`).emit('message:pin_updated', {
          messageId: req.params.messageId,
          conversationId,
          isPinned: false,
        });
      } catch { /* socket chưa khởi tạo */ }
      sendSuccess(res, null, 'Đã bỏ ghim tin nhắn');
    } catch (error) { next(error); }
  },

  reactToMessage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { conversationId, createdAt, emoji } = req.body as { conversationId: string; createdAt: string; emoji: string };
      const reactions = await chatService.reactToMessage(req.params.messageId, req.user!.userId, conversationId, createdAt, emoji);
      try {
        getIO().to(`conv:${conversationId}`).emit('message:reacted', {
          messageId: req.params.messageId,
          conversationId,
          reactions,
        });
      } catch { /* socket chưa khởi tạo */ }
      sendSuccess(res, reactions, 'Đã thả cảm xúc');
    } catch (error) { next(error); }
  },

  // ─── Group Management Controller Extensions ──────────────────────────

  updateGroup: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const group = await chatService.updateGroup(
        req.user!.userId,
        req.params.groupId,
        req.body,
      );
      try {
        getIO().to(`conv:${req.params.groupId}`).emit('group:updated', group);
      } catch { /* ignore */ }
      sendSuccess(res, group, 'Cập nhật nhóm thành công');
    } catch (error) { next(error); }
  },

  deleteGroup: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await chatService.deleteGroup(req.user!.userId, req.params.groupId);
      try {
        getIO().to(`conv:${req.params.groupId}`).emit('group:deleted', { groupId: req.params.groupId });
      } catch { /* ignore */ }
      sendSuccess(res, null, 'Giải tán nhóm thành công');
    } catch (error) { next(error); }
  },

  leaveGroup: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await chatService.leaveGroup(req.user!.userId, req.params.groupId);
      try {
        getIO().to(`conv:${req.params.groupId}`).emit('group:member_left', {
          groupId: req.params.groupId,
          userId: req.user!.userId,
        });
      } catch { /* ignore */ }
      sendSuccess(res, null, 'Rời nhóm thành công');
    } catch (error) { next(error); }
  },

  addMembers: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await chatService.addMembers(req.user!.userId, req.params.groupId, req.body);
      try {
        getIO().to(`conv:${req.params.groupId}`).emit('group:members_added', {
          groupId: req.params.groupId,
          memberIds: req.body.memberIds,
        });
      } catch { /* ignore */ }
      sendSuccess(res, null, 'Thêm thành viên thành công');
    } catch (error) { next(error); }
  },

  removeMember: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await chatService.removeMember(
        req.user!.userId,
        req.params.groupId,
        req.params.userId,
      );
      try {
        getIO().to(`conv:${req.params.groupId}`).emit('group:member_removed', {
          groupId: req.params.groupId,
          userId: req.params.userId,
        });
      } catch { /* ignore */ }
      sendSuccess(res, null, 'Xóa thành viên thành công');
    } catch (error) { next(error); }
  },

  changeMemberRole: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await chatService.changeMemberRole(
        req.user!.userId,
        req.params.groupId,
        req.params.userId,
        req.body.role,
      );
      try {
        getIO().to(`conv:${req.params.groupId}`).emit('group:role_changed', {
          groupId: req.params.groupId,
          userId: req.params.userId,
          role: req.body.role,
        });
      } catch { /* ignore */ }
      sendSuccess(res, null, 'Thay đổi quyền thành công');
    } catch (error) { next(error); }
  },

  // ─── Member Requests (Duyệt thành viên) ──────────────────────────────

  joinRequest: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await chatService.joinRequest(req.user!.userId, req.params.groupId);
      try {
        // Thông báo cho admin/owner của nhóm (hoặc toàn nhóm để update badge)
        getIO().to(`conv:${req.params.groupId}`).emit('group:join_request_new', { groupId: req.params.groupId });
      } catch { /* ignore */ }
      sendSuccess(res, null, 'Đã gửi yêu cầu tham gia');
    } catch (error) { next(error); }
  },

  getGroupRequests: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const requests = await chatService.getGroupRequests(req.params.groupId, req.user!.userId);
      sendSuccess(res, requests);
    } catch (error) { next(error); }
  },

  approveRequest: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await chatService.approveRequest(req.params.groupId, req.user!.userId, req.params.userId);
      try {
        getIO().to(`conv:${req.params.groupId}`).emit('group:member_joined', { 
          groupId: req.params.groupId,
          userId: req.params.userId 
        });
        // Thông báo riêng cho người được duyệt
        getIO().to(`user:${req.params.userId}`).emit('group:request_approved', { groupId: req.params.groupId });
      } catch { /* ignore */ }
      sendSuccess(res, null, 'Đã duyệt thành viên');
    } catch (error) { next(error); }
  },

  rejectRequest: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await chatService.rejectRequest(req.params.groupId, req.user!.userId, req.params.userId);
      try {
        getIO().to(`user:${req.params.userId}`).emit('group:request_rejected', { groupId: req.params.groupId });
        getIO().to(`conv:${req.params.groupId}`).emit('group:join_request_updated', { groupId: req.params.groupId });
      } catch { /* ignore */ }
      sendSuccess(res, null, 'Đã từ chối yêu cầu');
    } catch (error) { next(error); }
  },

  // ─── Polls (Bình chọn) ───────────────────────────────────────────────

  createPoll: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await chatService.createPoll(req.user!.userId, req.params.groupId, req.body);
      getIO().to(`conv:${req.params.groupId}`).emit('group:poll_new', { groupId: req.params.groupId });
      sendCreated(res, null, 'Tạo bình chọn thành công');
    } catch (error) { next(error); }
  },

  getPolls: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const polls = await chatService.getPolls(req.params.groupId);
      sendSuccess(res, polls);
    } catch (error) { next(error); }
  },

  votePoll: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { optionIndex } = req.body;
      await chatService.votePoll(req.user!.userId, req.params.groupId, req.params.pollId, optionIndex);
      getIO().to(`conv:${req.params.groupId}`).emit('group:poll_updated', { pollId: req.params.pollId });
      sendSuccess(res, null, 'Đã bình chọn');
    } catch (error) { next(error); }
  },

  unvotePoll: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { optionIndex } = req.body;
      await chatService.unvotePoll(req.user!.userId, req.params.groupId, req.params.pollId, optionIndex);
      getIO().to(`conv:${req.params.groupId}`).emit('group:poll_updated', { pollId: req.params.pollId });
      sendSuccess(res, null, 'Đã rút phiếu');
    } catch (error) { next(error); }
  },

  // ─── Tasks (Công việc) ───────────────────────────────────────────────

  createTask: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await chatService.createTask(req.user!.userId, req.params.groupId, req.body);
      getIO().to(`conv:${req.params.groupId}`).emit('group:task_new', { groupId: req.params.groupId });
      sendCreated(res, null, 'Đã tạo công việc');
    } catch (error) { next(error); }
  },

  getTasks: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tasks = await chatService.getTasks(req.params.groupId);
      sendSuccess(res, tasks);
    } catch (error) { next(error); }
  },

  updateTaskStatus: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await chatService.updateTaskStatus(req.params.groupId, req.params.taskId, req.body.status);
      getIO().to(`conv:${req.params.groupId}`).emit('group:task_updated', { taskId: req.params.taskId });
      sendSuccess(res, null, 'Cập nhật trạng thái thành công');
    } catch (error) { next(error); }
  },

  // ─── AI Recap ───────────────────────────────────────────────────────

  generateAIRecap: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const summary = await chatService.generateRecap(req.params.groupId);
      try {
        getIO().to(`conv:${req.params.groupId}`).emit('group:recap_new', { groupId: req.params.groupId, summary });
      } catch { /* ignore */ }
      sendSuccess(res, summary, 'Tóm tắt thành công');
    } catch (error) { next(error); }
  },

  getLatestAIRecap: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const summary = await chatService.getLatestRecap(req.params.groupId);
      sendSuccess(res, summary);
    } catch (error) { next(error); }
  },
};
