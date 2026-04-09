import type {
  IAiSuggestRequest, IAiSuggestResponse,
  IAiChatbotRequest, IAiChatbotResponse,
  IAiSentimentResult,
  IAiGeneratePostRequest, IAiGeneratePostResponse,
} from './ai.types.js';

export const aiService = {
  suggestContent: async (_request: IAiSuggestRequest): Promise<IAiSuggestResponse> => {
    // TODO: Gọi Gemini API để gợi ý nội dung
    throw new Error('Chưa triển khai');
  },

  chatbot: async (_request: IAiChatbotRequest): Promise<IAiChatbotResponse> => {
    // TODO: Gọi Gemini API cho chatbot hỗ trợ
    throw new Error('Chưa triển khai');
  },

  analyzeSentiment: async (_text: string): Promise<IAiSentimentResult> => {
    // TODO: Phân tích cảm xúc văn bản qua Gemini API
    throw new Error('Chưa triển khai');
  },

  generatePost: async (_request: IAiGeneratePostRequest): Promise<IAiGeneratePostResponse> => {
    // TODO: Tạo bài viết tự động qua Gemini API
    throw new Error('Chưa triển khai');
  },
};
