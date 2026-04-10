import { randomUUID } from 'crypto';
import { NotFoundError, ForbiddenError, AppError } from '@/shared/utils/errors.js';
import { chatRepository } from './chat.repository.js';
import type {
  IConversation,
  IConversationMember,
  IMessage,
  ICreateConversationDto,
  IUpdateGroupDto,
  ISendMessageDto,
} from './chat.types.js';


export const chatService = {
  // ─── Conversations ───────────────────────────────────────────────────────

  getConversations: async (_userId: string): Promise<IConversation[]> => {
    // TODO: Lấy danh sách hội thoại của user qua GSI
    void _userId;
    return [];
  },

  createConversation: async (creatorId: string, data: ICreateConversationDto): Promise<IConversation> => {
    if (data.type === 'group' && (!data.name || data.name.trim() === '')) {
      throw new AppError('Nhóm chat phải có tên', 400, 'GROUP_NAME_REQUIRED');
    }
    if (data.type === 'group' && data.memberIds.length < 2) {
      throw new AppError('Nhóm chat phải có ít nhất 3 thành viên (bao gồm người tạo)', 400, 'GROUP_MIN_MEMBERS');
    }

    const now = new Date().toISOString();
    const conversationId = randomUUID();

    const conversation: IConversation = {
      conversationId,
      type: data.type,
      ...(data.name && { name: data.name }),
      ...(data.avatar && { avatar: data.avatar }),
      creatorId,
      memberCount: data.memberIds.length + 1,
      isEncrypted: false,
      createdAt: now,
      updatedAt: now,
    };

    await chatRepository.createConversation(conversation);

    // Thêm người tạo là owner
    await chatRepository.addMember({
      conversationId,
      userId: creatorId,
      role: 'owner',
      joinedAt: now,
      unreadCount: 0,
      isMuted: false,
    });

    // Thêm các thành viên còn lại
    await Promise.all(
      data.memberIds.map((userId) =>
        chatRepository.addMember({
          conversationId,
          userId,
          role: 'member',
          joinedAt: now,
          unreadCount: 0,
          isMuted: false,
        })
      )
    );

    // Emit event tới socket của tất cả members (kèm creator)
    import('@/socket/index.js').then(({ getIO }) => {
      const io = getIO();
      const allMembers = [creatorId, ...data.memberIds];
      allMembers.forEach(userId => {
        io.to(`user:${userId}`).emit('group:new', conversation);
      });
    }).catch(err => {
      console.error('Không thể gửi socket event group:new', err);
    });

    return conversation;
  },

  // ─── Group APIs ──────────────────────────────────────────────────────────

  updateGroup: async (requesterId: string, conversationId: string, data: IUpdateGroupDto): Promise<IConversation> => {
    const conversation = await chatRepository.getConversationById(conversationId);
    if (!conversation) throw new AppError('Không tìm thấy nhóm', 404, 'GROUP_NOT_FOUND');
    if (conversation.type !== 'group') throw new AppError('Đây không phải nhóm chat', 400, 'NOT_A_GROUP');

    const member = await chatRepository.getMember(conversationId, requesterId);
    if (!member) throw new AppError('Bạn không phải thành viên nhóm', 403, 'NOT_A_MEMBER');
    if (!['owner', 'admin'].includes(member.role)) throw new AppError('Chỉ admin mới có thể chỉnh sửa nhóm', 403, 'FORBIDDEN');

    const updates: Partial<IConversation> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.avatar !== undefined) updates.avatar = data.avatar;

    await chatRepository.updateConversation(conversationId, updates);
    const updatedConversation = { ...conversation, ...updates, updatedAt: new Date().toISOString() };

    // Emit event cập nhật tới tất cả thành viên trong nhóm
    chatRepository.getMembers(conversationId).then(members => {
      import('@/socket/index.js').then(({ getIO }) => {
        const io = getIO();
        members.forEach(m => io.to(`user:${m.userId}`).emit('group:update', updatedConversation));
      }).catch(err => console.error('Lỗi lấy socket io info', err));
    }).catch(err => console.error('Lỗi lấy thành viên để emit socket', err));

    return updatedConversation;
  },

  deleteGroup: async (requesterId: string, conversationId: string): Promise<void> => {
    const conversation = await chatRepository.getConversationById(conversationId);
    if (!conversation) throw new NotFoundError('Nhóm');
    if (conversation.type !== 'group') throw new AppError('Đây không phải nhóm chat', 400, 'NOT_A_GROUP');
    if (conversation.creatorId !== requesterId) throw new ForbiddenError('Chỉ người tạo mới có thể giải tán nhóm');

    // Soft-delete: cập nhật isDeleted thay vì xóa hẳn
    await chatRepository.updateConversation(conversationId, {
      name: `[ĐÃ GIẢI TÁN] ${conversation.name}`,
      isDeleted: true,
    } as Partial<IConversation>);

    // Emit event để client ẩn/khóa nhóm
    chatRepository.getMembers(conversationId).then(members => {
      import('@/socket/index.js').then(({ getIO }) => {
        const io = getIO();
        members.forEach(m => io.to(`user:${m.userId}`).emit('group:delete', { conversationId }));
      }).catch(err => console.error('Lỗi lấy socket io info', err));
    }).catch(err => console.error('Lỗi lấy thành viên để emit socket delete', err));
  },

  leaveGroup: async (userId: string, conversationId: string): Promise<void> => {
    const conversation = await chatRepository.getConversationById(conversationId);
    if (!conversation) throw new NotFoundError('Nhóm');
    if (conversation.type !== 'group') throw new AppError('Đây không phải nhóm chat', 400, 'NOT_A_GROUP');

    const member = await chatRepository.getMember(conversationId, userId);
    if (!member) throw new ForbiddenError('Bạn không phải thành viên nhóm');
    if (member.role === 'owner') {
      throw new AppError('Chủ nhóm không thể rời. Hãy chuyển quyền hoặc giải tán nhóm.', 400, 'OWNER_CANNOT_LEAVE');
    }

    await chatRepository.removeMember(conversationId, userId);
    await chatRepository.updateConversation(conversationId, {
      memberCount: Math.max(0, conversation.memberCount - 1),
    } as Partial<IConversation>);

    // Bắn realtime để update UI
    chatRepository.getMembers(conversationId).then(members => {
      import('@/socket/index.js').then(({ getIO }) => {
        const io = getIO();
        // Báo cho những người CÒN LẠI trong nhóm
        members.forEach(m => io.to(`user:${m.userId}`).emit('group:member_leave', { conversationId, userId }));
        // Báo riêng cho người VỪA RỜI để gỡ chat ra khỏi danh sách
        io.to(`user:${userId}`).emit('group:leave', { conversationId });
      }).catch(err => console.error('Lỗi lấy socket io', err));
    }).catch(err => console.error('Lỗi socket báo rời nhóm', err));
  },

  // ─── Messages ────────────────────────────────────────────────────────────

  getMessages: async (conversationId: string, limit?: number): Promise<IMessage[]> => {
    return chatRepository.getMessages(conversationId, limit);
  },

  sendMessage: async (_senderId: string, _conversationId: string, _data: ISendMessageDto): Promise<IMessage> => {
    // TODO: Tạo message, cập nhật lastMessage của conversation, emit socket event
    throw new Error('Chưa triển khai');
  },

  editMessage: async (_messageId: string, _content: string): Promise<void> => {
    throw new Error('Chưa triển khai');
  },

  deleteMessage: async (_messageId: string): Promise<void> => {
    throw new Error('Chưa triển khai');
  },

  recallMessage: async (_messageId: string): Promise<void> => {
    throw new Error('Chưa triển khai');
  },
};
