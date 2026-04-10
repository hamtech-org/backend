import { Request, Response, NextFunction } from 'express';
import { chatService } from './chat.service.js';
import { sendSuccess, sendCreated } from '@/shared/utils/response.js';

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

  /** PUT /api/groups/:groupId — Cập nhật tên / avatar nhóm */
  updateGroup: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const updated = await chatService.updateGroup(
        req.user!.userId,
        req.params.groupId,
        req.body,
      );
      sendSuccess(res, updated, 'Cập nhật nhóm thành công');
    } catch (error) { next(error); }
  },

  /** DELETE /api/groups/:groupId — Giải tán nhóm */
  deleteGroup: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await chatService.deleteGroup(req.user!.userId, req.params.groupId);
      sendSuccess(res, null, 'Giải tán nhóm thành công');
    } catch (error) { next(error); }
  },

  /** POST /api/groups/:groupId/leave — Rời nhóm */
  leaveGroup: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await chatService.leaveGroup(req.user!.userId, req.params.groupId);
      sendSuccess(res, null, 'Rời nhóm thành công');
    } catch (error) { next(error); }
  },

  // ─── Messages ──────────────────────────────────────────────────────────────────

  getMessages: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const messages = await chatService.getMessages(req.params.conversationId);
      sendSuccess(res, messages);
    } catch (error) { next(error); }
  },

  sendMessage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const message = await chatService.sendMessage(req.user!.userId, req.params.conversationId, req.body);
      sendCreated(res, message);
    } catch (error) { next(error); }
  },

  editMessage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { content } = req.body as { content: string };
      await chatService.editMessage(req.params.messageId, content);
      sendSuccess(res, null, 'Chỉnh sửa thành công');
    } catch (error) { next(error); }
  },

  deleteMessage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await chatService.deleteMessage(req.params.messageId);
      sendSuccess(res, null, 'Xóa thành công');
    } catch (error) { next(error); }
  },

  recallMessage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await chatService.recallMessage(req.params.messageId);
      sendSuccess(res, null, 'Thu hồi thành công');
    } catch (error) { next(error); }
  },
};
