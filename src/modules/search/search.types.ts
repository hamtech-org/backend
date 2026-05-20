export interface ISearchResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface ISearchOptions {
  query: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  filters?: Record<string, unknown>;
  userId?: string; // Current user ID for friendship check
  tags?: string[];
  categories?: string[];
}

export interface ISearchUserResult {
  userId: string;
  displayName: string;
  email: string;
  avatar: string | null;
  bio: string | null;
  isFriend?: boolean; // Whether current user is friend with this user
  friendshipStatus?: 'friend' | 'pending_sent' | 'pending_received' | 'none'; // Detailed friendship status
}

export interface ISearchPostResult {
  postId: string;
  authorId: string;
  content: string;
  type: string;
  createdAt: string;
}

export interface ISearchGroupResult {
  groupId: string;
  communityId?: string;
  name: string;
  description: string | null;
  slug?: string;
  avatar?: string | null;
  coverUrl?: string | null;
  category?: string;
  memberCount: number;
  type: string;
}

export interface ISearchMessageResult {
  messageId: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: string;
}

export interface ISearchAllResult {
  users: ISearchResult<ISearchUserResult>;
  posts: ISearchResult<ISearchPostResult>;
  groups: ISearchResult<ISearchGroupResult>;
}

export interface ISearchAllChatResult {
  users: ISearchResult<ISearchUserResult>;
  groups: ISearchResult<ISearchGroupResult>;
  messages: ISearchResult<ISearchMessageResult>;
}
