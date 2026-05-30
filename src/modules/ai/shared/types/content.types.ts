export interface IAiSuggestRequest {
  context: string;
  type: 'reply' | 'post' | 'caption';
  language: 'vi' | 'en';
  topics: string[];
}

export interface IAiSuggestResponse {
  suggestions: string[];
  model: string;
  tokensUsed: number;
}

export interface IAiChatbotRequest {
  message: string;
  conversationHistory: IChatbotMessage[];
}

export interface IChatbotMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface IAiChatbotResponse {
  reply: string;
  model: string;
  tokensUsed: number;
}

export interface IAiSentimentResult {
  text: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  confidence: number;
  language: string;
}

export interface IAiGeneratePostRequest {
  topic: string;
  tone: 'formal' | 'casual' | 'humorous';
  maxLength: number;
}

export interface IAiGeneratePostResponse {
  content: string;
  hashtags: string[];
  model: string;
  tokensUsed: number;
}

export interface IAiSuggestReplyContextRequest {
  conversationId: string;
  meUserId: string;
  theirUserId: string;
  anchorMessageId: string;
  count?: number;
  windowBefore?: number;
  windowAfter?: number;
}

export interface IAiSuggestReplyContextResponse {
  suggestions: string[];
  model: string;
  tokensUsed: number;
}

export interface IAiGroupSummaryRequest {
  conversationId: string;
  limit?: number;
}

export interface IAiGroupSummaryResponse {
  summary: string;
  highlights: string[];
  unreadSummary: string;
  unreadMessageCount: number;
  model: string;
  tokensUsed: number;
}
