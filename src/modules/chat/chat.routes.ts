import { Router } from 'express';
import { chatController } from './chat.controller.js';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';
import { validate } from '@/shared/middlewares/validate.middleware.js';
import {
  createConversationSchema,
  sendMessageSchema,
  editMessageSchema,
  deleteMessageSchema,
  recallMessageSchema,
  markAsReadSchema,
  reactMessageSchema,
  updateGroupSchema,
  addMembersSchema,
  changeRoleSchema,
} from './chat.validator.js';

const router = Router();

// ─── Conversations ────────────────────────────────────────────────────────────
router.get('/conversations', authenticate, chatController.getConversations);
router.post('/conversations', authenticate, validate(createConversationSchema), chatController.createConversation);
router.get('/conversations/:conversationId', authenticate, chatController.getConversation);
router.get('/conversations/:conversationId/messages', authenticate, chatController.getMessages);
router.post('/conversations/:conversationId/messages', authenticate, validate(sendMessageSchema), chatController.sendMessage);
router.post('/conversations/:conversationId/read', authenticate, validate(markAsReadSchema), chatController.markAsRead);

// ─── Messages ─────────────────────────────────────────────────────────────────
router.put('/messages/:messageId', authenticate, validate(editMessageSchema), chatController.editMessage);
router.delete('/messages/:messageId', authenticate, validate(deleteMessageSchema), chatController.deleteMessage);
router.post('/messages/:messageId/recall', authenticate, validate(recallMessageSchema), chatController.recallMessage);
router.post('/messages/:messageId/pin', authenticate, chatController.pinMessage);
router.delete('/messages/:messageId/pin', authenticate, chatController.unpinMessage);
router.post('/messages/:messageId/react', authenticate, validate(reactMessageSchema), chatController.reactToMessage);

// ─── Group Management ────────────────────────────────────────────────────────
// Lấy danh sách thành viên nhóm
router.get('/groups/:groupId/members', authenticate, chatController.getGroupMembers);
// Cập nhật thông tin nhóm (tên / avatar nhóm)
router.put('/groups/:groupId', authenticate, validate(updateGroupSchema), chatController.updateGroup);
// Xóa nhóm (Giải tán nhóm)
router.delete('/groups/:groupId', authenticate, chatController.deleteGroup);
// Rời khỏi nhóm
router.post('/groups/:groupId/leave', authenticate, chatController.leaveGroup);
// Thêm thành viên
router.post('/groups/:groupId/members', authenticate, validate(addMembersSchema), chatController.addMembers);
// Xóa thành viên (Kick)
router.delete('/groups/:groupId/members/:userId', authenticate, chatController.removeMember);
// Phân quyền thành viên
router.put('/groups/:groupId/members/:userId/role', authenticate, validate(changeRoleSchema), chatController.changeMemberRole);

// ─── Member Requests (Duyệt thành viên) ──────────────────────────────
// Yêu cầu tham gia nhóm
router.post('/groups/:groupId/request', authenticate, chatController.joinRequest);
// Lấy danh sách yêu cầu tham gia nhóm
router.get('/groups/:groupId/requests', authenticate, chatController.getGroupRequests);
// Duyệt yêu cầu tham gia nhóm
router.post('/groups/:groupId/requests/:userId/approve', authenticate, chatController.approveRequest);
// Từ chối yêu cầu tham gia nhóm
router.post('/groups/:groupId/requests/:userId/reject', authenticate, chatController.rejectRequest);

// ─── Polls (Bình chọn) ───────────────────────────────────────────────
// Lấy danh sách bình chọn
router.get('/groups/:groupId/polls', authenticate, chatController.getPolls);
// Tạo bình chọn
router.post('/groups/:groupId/polls', authenticate, chatController.createPoll);
// Bỏ phiếu
router.post('/groups/:groupId/polls/:pollId/vote', authenticate, chatController.votePoll);
// Hủy bỏ phiếu
router.post('/groups/:groupId/polls/:pollId/unvote', authenticate, chatController.unvotePoll);
// Thêm lựa chọn
router.post('/groups/:groupId/polls/:pollId/options', authenticate, chatController.addPollOption);
// Đóng bình chọn
router.post('/groups/:groupId/polls/:pollId/close', authenticate, chatController.closePoll);

// ─── Tasks (Công việc) ───────────────────────────────────────────────
// Lấy danh sách công việc
router.get('/groups/:groupId/tasks', authenticate, chatController.getTasks);
// Tạo công việc
router.post('/groups/:groupId/tasks', authenticate, chatController.createTask);
// Cập nhật trạng thái công việc
router.put('/groups/:groupId/tasks/:taskId', authenticate, chatController.updateTaskStatus);
// Tham gia công việc
router.post('/groups/:groupId/tasks/:taskId/join', authenticate, chatController.joinTask);

// ─── AI Recap ───────────────────────────────────────────────────────
// Tạo AI Recap
router.post('/groups/:groupId/ai-recap', authenticate, chatController.generateAIRecap);
// Lấy AI Recap mới nhất
router.get('/groups/:groupId/ai-recap/latest', authenticate, chatController.getLatestAIRecap);

export default router;
