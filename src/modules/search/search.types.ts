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
}

export interface ISearchUserResult {
  userId: string;
  displayName: string;
  avatar: string | null;
  bio: string | null;
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
  name: string;
  description: string | null;
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
  messages: ISearchResult<ISearchMessageResult>;
}
