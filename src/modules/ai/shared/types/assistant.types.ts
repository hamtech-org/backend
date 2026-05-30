export type AiAssistantClientAction =
  | {
      type: 'open_create_poll';
      payload: { conversationId?: string; question?: string; options?: string[] };
    }
  | {
      type: 'show_user_cards';
      payload: {
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
      type: 'show_message_results';
      payload: {
        source: 'search_messages';
        query: string;
        messages: Array<{
          resultKey?: string;
          messageId: string;
          conversationId: string;
          conversationName?: string | null;
          senderId: string;
          senderDisplayName?: string | null;
          content: string;
          createdAt: string;
        }>;
      };
    }
  | {
      type: 'show_group_results';
      payload: {
        source: 'search_groups';
        query: string;
        groups: Array<{
          groupId: string;
          name: string;
          description: string | null;
          memberCount: number;
          type: string;
        }>;
      };
    }
  | {
      type: 'show_community_results';
      payload: {
        source: 'search_communities';
        query: string;
        communities: Array<{
          resultKey?: string;
          groupId: string;
          communityId: string;
          name: string;
          description: string | null;
          category?: string | null;
          memberCount: number;
          type: string;
          slug?: string | null;
          avatar?: string | null;
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
