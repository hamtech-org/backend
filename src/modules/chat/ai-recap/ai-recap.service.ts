import { v4 as uuidv4 } from 'uuid';
import { aiRecapRepository } from './ai-recap.repository.js';
import { conversationRepository } from '../conversation/conversation.repository.js';

export const aiRecapService = {
  generateRecap: async (conversationId: string): Promise<any> => {
    // 1. Lấy tin nhắn gần đây
    const messages = await conversationRepository.getMessages(conversationId, 50);
    const text = messages.map((m) => `${m.senderId}: ${m.content}`).join('\n');

    // 2. Gọi AI (Mock)
    const summaryText = `[AI Tóm tắt]: Cuộc hội thoại xoay quanh việc ${text.length > 0 ? 'trao đổi thông tin dự án' : 'chưa có nội dung mới'}.`;

    const summary = {
      summaryId: uuidv4(),
      conversationId,
      content: summaryText,
      createdAt: new Date().toISOString(),
    };

    await aiRecapRepository.saveAISummary(conversationId, summary);
    return summary;
  },

  getLatestRecap: async (conversationId: string): Promise<any> => {
    return aiRecapRepository.getLatestAISummary(conversationId);
  },
};
