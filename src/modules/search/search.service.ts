import { esClient } from '@/config/elasticsearch.js';
import type {
  ISearchResult, ISearchOptions,
  ISearchUserResult, ISearchPostResult,
  ISearchGroupResult, ISearchMessageResult,
  ISearchAllResult,
  ISearchAllChatResult,
} from './search.types.js';

export const searchService = {
  searchMessages: async (_userId: string, options: ISearchOptions): Promise<ISearchResult<ISearchMessageResult>> => {
    const page = options.page || 1;
    const pageSize = options.pageSize || 20;
    const from = (page - 1) * pageSize;

    try {
      const result = await esClient.search({
        index: 'messages',
        from,
        size: pageSize,
        query: {
          bool: {
            must: [
              {
                term: {
                  senderId: _userId,  // Filter messages from/to user
                },
              },
            ],
            should: [
              {
                match: {
                  content: {
                    query: options.query,
                    fuzziness: 'AUTO',
                    operator: 'or',
                  },
                },
              },
              {
                match_phrase_prefix: {
                  content: options.query,
                },
              },
            ],
            minimum_should_match: 1,
          },
        },
        _source: ['messageId', 'conversationId', 'senderId', 'content', 'createdAt'],
        track_total_hits: true,
      });

      const items: ISearchMessageResult[] = result.hits.hits.map(hit => {
        const source = hit._source as ISearchMessageResult;
        return {
          messageId: source.messageId,
          conversationId: source.conversationId,
          senderId: source.senderId,
          content: source.content,
          createdAt: source.createdAt,
        };
      });

      const total = typeof result.hits.total === 'number' ? result.hits.total : result.hits.total?.value || 0;
      const hasMore = from + pageSize < total;

      return {
        items,
        total,
        page,
        pageSize,
        hasMore,
      };
    } catch (error) {
      console.error('Search messages error:', error);
      return { items: [], total: 0, page, pageSize, hasMore: false };
    }
  },

  searchUsers: async (options: ISearchOptions): Promise<ISearchResult<ISearchUserResult>> => {
    const page = options.page || 1;
    const pageSize = options.pageSize || 20;
    const from = (page - 1) * pageSize;

    try {
      const result = await esClient.search({
        index: 'users',
        from,
        size: pageSize,
        query: {
          bool: {
            should: [
              {
                match: {
                  displayName: {
                    query: options.query,
                    fuzziness: 'AUTO',
                    operator: 'or',
                  },
                },
              },
              {
                match: {
                  email: {
                    query: options.query,
                    fuzziness: 'AUTO',
                    operator: 'or',
                  },
                },
              },
              {
                match_phrase_prefix: {
                  displayName: options.query,
                },
              },
              {
                match_phrase_prefix: {
                  email: options.query,
                },
              },
            ],
            minimum_should_match: 1,
          },
        },
        _source: ['userId', 'displayName', 'email', 'avatar', 'bio'],
        track_total_hits: true,
      });

      const items: ISearchUserResult[] = result.hits.hits.map(hit => {
        const source = hit._source as ISearchUserResult;
        return {
          userId: source.userId,
          displayName: source.displayName,
          email: source.email,
          avatar: source.avatar || null,
          bio: source.bio || null,
        };
      });

      const total = typeof result.hits.total === 'number' ? result.hits.total : result.hits.total?.value || 0;
      const hasMore = from + pageSize < total;

      return {
        items,
        total,
        page,
        pageSize,
        hasMore,
      };

    } catch (error) {
      console.error('Search users error:', error);
      return { items: [], total: 0, page, pageSize, hasMore: false };
    }
  },

  searchGroups: async (options: ISearchOptions): Promise<ISearchResult<ISearchGroupResult>> => {
    const page = options.page || 1;
    const pageSize = options.pageSize || 20;
    const from = (page - 1) * pageSize;

    try {
      const result = await esClient.search({
        index: 'groups',
        from,
        size: pageSize,
        query: {
          bool: {
            should: [
              {
                match: {
                  name: {
                    query: options.query,
                    fuzziness: 'AUTO',
                    operator: 'or',
                  },
                },
              },
              {
                match: {
                  description: {
                    query: options.query,
                    fuzziness: 'AUTO',
                    operator: 'or',
                  },
                },
              },
              {
                match_phrase_prefix: {
                  name: options.query,
                },
              },
            ],
            minimum_should_match: 1,
          },
        },
        _source: ['groupId', 'name', 'description', 'memberCount', 'type'],
        track_total_hits: true,
      });

      const items: ISearchGroupResult[] = result.hits.hits.map(hit => {
        const source = hit._source as ISearchGroupResult;
        return {
          groupId: source.groupId,
          name: source.name,
          description: source.description || null,
          memberCount: source.memberCount,
          type: source.type,
        };
      });

      const total = typeof result.hits.total === 'number' ? result.hits.total : result.hits.total?.value || 0;
      const hasMore = from + pageSize < total;

      return {
        items,
        total,
        page,
        pageSize,
        hasMore,
      };
    } catch (error) {
      console.error('Search groups error:', error);
      return { items: [], total: 0, page, pageSize, hasMore: false };
    }
  },

  searchPosts: async (options: ISearchOptions): Promise<ISearchResult<ISearchPostResult>> => {
    const page = options.page || 1;
    const pageSize = options.pageSize || 20;
    const from = (page - 1) * pageSize;

    try {
      const result = await esClient.search({
        index: 'posts',
        from,
        size: pageSize,
        query: {
          bool: {
            should: [
              {
                match: {
                  content: {
                    query: options.query,
                    fuzziness: 'AUTO',
                    operator: 'or',
                  },
                },
              },
              {
                match_phrase_prefix: {
                  content: options.query,
                },
              },
            ],
            minimum_should_match: 1,
          },
        },
        _source: ['postId', 'authorId', 'content', 'type', 'createdAt'],
        track_total_hits: true,
      });

      const items: ISearchPostResult[] = result.hits.hits.map(hit => {
        const source = hit._source as ISearchPostResult;
        return {
          postId: source.postId,
          authorId: source.authorId,
          content: source.content,
          type: source.type,
          createdAt: source.createdAt,
        };
      });

      const total = typeof result.hits.total === 'number' ? result.hits.total : result.hits.total?.value || 0;
      const hasMore = from + pageSize < total;

      return {
        items,
        total,
        page,
        pageSize,
        hasMore,
      };
    } catch (error) {
      console.error('Search posts error:', error);
      return { items: [], total: 0, page, pageSize, hasMore: false };
    }
  },

  searchAll: async (_userId: string, options: ISearchOptions): Promise<ISearchAllResult> => {
    // Tìm kiếm tổng hợp trên tất cả index
    try {
      const [usersResult, postsResult, groupsResult] = await Promise.all([
        searchService.searchUsers({ ...options, pageSize: 5 }),
        searchService.searchPosts({ ...options, pageSize: 5 }),
        searchService.searchGroups({ ...options, pageSize: 5 }),
      ]);

      return {
        users: usersResult,
        posts: postsResult,
        groups: groupsResult,
      };
    } catch (error) {

      console.error('Search all error:', error);

      return {
        users: { items: [], total: 0, page: 1, pageSize: 20, hasMore: false },
        posts: { items: [], total: 0, page: 1, pageSize: 20, hasMore: false },
        groups: { items: [], total: 0, page: 1, pageSize: 20, hasMore: false },
      };
    }
  },

  searchAllChat: async (_userId: string, options: ISearchOptions): Promise<ISearchAllChatResult> => {
    // Tìm kiếm tổng hợp cho chat: users, groups, messages
    try {
      const [usersResult, groupsResult, messagesResult] = await Promise.all([
        searchService.searchUsers({ ...options, pageSize: 5 }),
        searchService.searchGroups({ ...options, pageSize: 5 }),
        searchService.searchMessages(_userId, { ...options, pageSize: 5 }),
      ]);

      return {
        users: usersResult,
        groups: groupsResult,
        messages: messagesResult,
      };
    } catch (error) {
      console.error('Search all chat error:', error);
      return {
        users: { items: [], total: 0, page: 1, pageSize: 20, hasMore: false },
        groups: { items: [], total: 0, page: 1, pageSize: 20, hasMore: false },
        messages: { items: [], total: 0, page: 1, pageSize: 20, hasMore: false },
      };
    }
  },

};
