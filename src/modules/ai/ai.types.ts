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

export interface IAiGroupSummaryRequest {
  conversationId: string;
  /** số tin nhắn gần nhất để tóm tắt */
  limit?: number;
}

export interface IAiGroupSummaryResponse {
  /** Tóm tắt ngắn 3-6 bullet */
  summary: string;
  /** Các điểm cần làm / quyết định / câu hỏi còn bỏ ngỏ */
  highlights: string[];
  model: string;
  tokensUsed: number;
}

export type AiAssistantClientAction =
  | {
      type: 'open_create_poll';
      payload: { conversationId?: string; question?: string; options?: string[] };
    }
  | {
      type: 'show_user_cards';
      payload: {
        /** Tool nào tạo ra (search_users / search_users_contacts). */
        source: 'search_users' | 'search_users_contacts';
        query: string;
        users: Array<{
          userId: string;
          displayName: string;
          email?: string | null;
          phone?: string | null;
          avatar?: string | null;
          bio?: string | null;
          isFriend?: boolean;
          friendshipStatus?: string;
        }>;
      };
    }
  | {
      type: 'confirm_tool';
      payload: {
        pendingId: string;
        toolName: string;
        question: string;
        confirmText: string;
        cancelText: string;
        confirmToken?: string;
        cancelToken?: string;
      };
    }
  | {
      type: 'open_search';
      payload: { tab: 'messages' | 'users' | 'groups' | 'contacts'; query: string };
    }
  | {
      type: 'open_direct_chat';
      payload: { otherUserId: string };
    };

export interface IAiAssistantRequest {
  /** Luôn lấy từ JWT / socket — không tin body từ client. */
  userId: string;
  message: string;
  threadId?: string;
  locale?: 'vi' | 'en';
}

export interface IAiAssistantResponse {
  reply: string;
  model: string;
  tokensUsed: number;
  threadId: string;
  actions?: AiAssistantClientAction[];
  userMessageId?: string;
  assistantMessageId?: string;
}
