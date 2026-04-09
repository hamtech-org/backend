import { chatRepository } from './chat.repository.js';
import type { IConversation, IMessage, ICreateConversationDto, ISendMessageDto } from './chat.types.js';

export const chatService = {
  getConversations: async (_userId: string): Promise<IConversation[]> => {
    // TODO: Lấy danh sách hội thoại của user qua GSI
    void _userId;
    return [];
  },

  createConversation: async (_creatorId: string, _data: ICreateConversationDto): Promise<IConversation> => {
    // TODO: Tạo conversation + thêm members
    throw new Error('Chưa triển khai');
  },

  getMessages: async (conversationId: string, limit?: number): Promise<IMessage[]> => {
    return chatRepository.getMessages(conversationId, limit);
  },

  sendMessage: async (_senderId: string, _conversationId: string, _data: ISendMessageDto): Promise<IMessage> => {
    // TODO: Tạo message, cập nhật lastMessage của conversation, emit socket event
    throw new Error('Chưa triển khai');
  },

  editMessage: async (_messageId: string, _content: string): Promise<void> => {
    // TODO: Cập nhật nội dung tin nhắn
    throw new Error('Chưa triển khai');
  },

  deleteMessage: async (_messageId: string): Promise<void> => {
    // TODO: Soft delete tin nhắn
    throw new Error('Chưa triển khai');
  },

  recallMessage: async (_messageId: string): Promise<void> => {
    // TODO: Thu hồi tin nhắn
    throw new Error('Chưa triển khai');
  },
};
