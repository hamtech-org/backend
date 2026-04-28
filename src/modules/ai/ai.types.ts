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
  /** id của mình (server nên validate khớp token) */
  meUserId: string;
  /** id của người mình sẽ trả lời */
  theirUserId: string;
  /** id tin nhắn của đối phương mà mình muốn trả lời */
  anchorMessageId: string;
  /** số gợi ý trả lời */
  count?: number;
  /** số tin nhắn trước anchor để lấy ngữ cảnh */
  windowBefore?: number;
  /** số tin nhắn sau anchor để lấy ngữ cảnh */
  windowAfter?: number;
}

export interface IAiSuggestReplyContextResponse {
  suggestions: string[];
  model: string;
  tokensUsed: number;
}
