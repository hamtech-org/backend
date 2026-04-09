import type {
  ISearchResult, ISearchOptions,
  ISearchUserResult, ISearchPostResult,
  ISearchGroupResult, ISearchMessageResult,
  ISearchAllResult,
} from './search.types.js';

export const searchService = {
  searchMessages: async (_userId: string, _options: ISearchOptions): Promise<ISearchResult<ISearchMessageResult>> => {
    // TODO: Tìm kiếm tin nhắn qua Elasticsearch
    return { items: [], total: 0, page: 1, pageSize: 20, hasMore: false };
  },

  searchUsers: async (_options: ISearchOptions): Promise<ISearchResult<ISearchUserResult>> => {
    // TODO: Tìm kiếm người dùng qua Elasticsearch
    return { items: [], total: 0, page: 1, pageSize: 20, hasMore: false };
  },

  searchGroups: async (_options: ISearchOptions): Promise<ISearchResult<ISearchGroupResult>> => {
    // TODO: Tìm kiếm nhóm qua Elasticsearch
    return { items: [], total: 0, page: 1, pageSize: 20, hasMore: false };
  },

  searchPosts: async (_options: ISearchOptions): Promise<ISearchResult<ISearchPostResult>> => {
    // TODO: Tìm kiếm bài viết qua Elasticsearch
    return { items: [], total: 0, page: 1, pageSize: 20, hasMore: false };
  },

  searchAll: async (_userId: string, _options: ISearchOptions): Promise<ISearchAllResult> => {
    // TODO: Tìm kiếm tổng hợp trên tất cả index
    return {
      users: { items: [], total: 0, page: 1, pageSize: 20, hasMore: false },
      posts: { items: [], total: 0, page: 1, pageSize: 20, hasMore: false },
      groups: { items: [], total: 0, page: 1, pageSize: 20, hasMore: false },
      messages: { items: [], total: 0, page: 1, pageSize: 20, hasMore: false },
    };
  },
};
