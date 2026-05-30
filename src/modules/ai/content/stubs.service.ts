import type {
  IAiChatbotRequest,
  IAiChatbotResponse,
  IAiSentimentResult,
  IAiGeneratePostRequest,
  IAiGeneratePostResponse,
} from '../shared/types/content.types.js';

export const contentStubsService = {
  chatbot: async (_request: IAiChatbotRequest): Promise<IAiChatbotResponse> => {
    throw new Error('Chưa triển khai');
  },

  analyzeSentiment: async (_text: string): Promise<IAiSentimentResult> => {
    throw new Error('Chưa triển khai');
  },

  generatePost: async (_request: IAiGeneratePostRequest): Promise<IAiGeneratePostResponse> => {
    throw new Error('Chưa triển khai');
  },
};
