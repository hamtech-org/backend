import { esClient } from '@/config/elasticsearch.js';
import { userRepository } from '@/modules/user/user.repository.js';
import { conversationRepository } from '@/modules/chat/conversation/conversation.repository.js';
import type {
  ISearchResult,
  ISearchOptions,
  ISearchUserResult,
  ISearchPostResult,
  ISearchGroupResult,
  ISearchMessageResult,
  ISearchAllResult,
  ISearchAllChatResult,
} from './search.types.js';

function normalizeSearchText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function textMatchesQuery(text: string, query: string): boolean {
  const haystack = normalizeSearchText(text);
  const needle = normalizeSearchText(query);
  if (!needle || needle === '*') return true;
  if (haystack.includes(needle)) return true;
  const terms = needle.split(/\s+/).filter(Boolean);
  return terms.length > 0 && terms.every((term) => haystack.includes(term));
}

export const searchService = {
  searchMessages: async (
    _userId: string,
    options: ISearchOptions,
  ): Promise<ISearchResult<ISearchMessageResult>> => {
    const page = options.page || 1;
    const pageSize = options.pageSize || 20;
    const from = (page - 1) * pageSize;

    try {
      const convs = await conversationRepository.getConversations(_userId);
      const conversationIds = convs.map((c) => c.conversationId);
      if (conversationIds.length === 0) {
        return { items: [], total: 0, page, pageSize, hasMore: false };
      }

      const result = await esClient.search({
        index: 'messages',
        from,
        size: pageSize,
        query: {
          bool: {
            must: [
              {
                terms: {
                  conversationId: conversationIds, // Only messages in conversations user belongs to
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

      const rawItems: ISearchMessageResult[] = result.hits.hits.map((hit) => {
        const source = hit._source as ISearchMessageResult;
        return {
          messageId: source.messageId,
          conversationId: source.conversationId,
          senderId: source.senderId,
          content: source.content,
          createdAt: source.createdAt,
        };
      });
      const senderIds = [...new Set(rawItems.map((item) => item.senderId).filter(Boolean))];
      const senders = await userRepository.findByIds(senderIds);
      const senderNameById = new Map(senders.map((user) => [user.userId, user.displayName]));
      const conversationNameById = new Map(
        convs.map((conversation) => [conversation.conversationId, conversation.name ?? null]),
      );
      const items = rawItems.map((item) => ({
        ...item,
        conversationName: conversationNameById.get(item.conversationId) ?? null,
        senderDisplayName: senderNameById.get(item.senderId) ?? null,
      }));

      const total =
        typeof result.hits.total === 'number' ? result.hits.total : result.hits.total?.value || 0;
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

      let items: ISearchUserResult[] = result.hits.hits.map((hit) => {
        const source = hit._source as ISearchUserResult;
        return {
          userId: source.userId,
          displayName: source.displayName,
          email: source.email,
          avatar: source.avatar || null,
          bio: source.bio || null,
          isFriend: false,
        };
      });

      // ✅ Filter out current user
      if (options.userId) {
        items = items.filter((user) => user.userId !== options.userId);
      }

      // ✅ Optimized: Batch get all friend IDs once instead of checking each individually
      console.log('searchUsers - Current userId:', options.userId);
      console.log(
        'searchUsers - Found users:',
        items.map((u) => u.userId),
      );

      if (options.userId) {
        try {
          const userFriendIds = await userRepository.getFriendIds(options.userId, 1000);
          const userFriendIdsSet = new Set(userFriendIds);
          console.log('searchUsers - User friend IDs from Set:', Array.from(userFriendIdsSet));

          // Get pending requests
          const { received, sent } = await userRepository.getPendingRequests(options.userId);
          console.log('searchUsers - Pending received:', received, 'Pending sent:', sent);
          const pendingReceivedSet = new Set(received);
          const pendingSentSet = new Set(sent);

          items = await Promise.all(
            items.map(async (user) => {
              let friendshipStatus: 'friend' | 'pending_sent' | 'pending_received' | 'none' =
                'none';

              console.log(
                `Checking friendship for user ${user.userId} against currentUser ${options.userId}`,
              );

              // Double-check friendship status directly from DB to ensure accuracy
              if (userFriendIdsSet.has(user.userId) && options.userId) {
                console.log(`User ${user.userId} is in friend list`);
                const isFriendConfirmed = await userRepository.checkFriendship(
                  options.userId,
                  user.userId,
                );
                if (isFriendConfirmed) {
                  friendshipStatus = 'friend';
                }
              } else if (pendingSentSet.has(user.userId)) {
                console.log(`User ${user.userId} has pending_sent status`);
                friendshipStatus = 'pending_sent';
              } else if (pendingReceivedSet.has(user.userId)) {
                console.log(`User ${user.userId} has pending_received status`);
                friendshipStatus = 'pending_received';
              } else {
                console.log(`User ${user.userId} has no friendship`);
              }

              return {
                ...user,
                isFriend: friendshipStatus === 'friend',
                friendshipStatus,
              };
            }),
          );
        } catch (error) {
          console.error('Error checking friendships:', error);
          // Continue without friendship data if check fails
        }
      } else {
        console.log('searchUsers - No userId provided, skipping friendship check');
      }

      const total =
        typeof result.hits.total === 'number' ? result.hits.total : result.hits.total?.value || 0;
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
      const visibleGroupConversations = options.userId
        ? (await conversationRepository.getConversations(options.userId)).filter(
            (conversation) => conversation.type === 'group' && !conversation.isDeleted,
          )
        : [];
      const visibleGroupById = new Map(
        visibleGroupConversations.map((conversation) => [
          conversation.conversationId,
          conversation,
        ]),
      );
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
            filter: [{ term: { isActive: true } }, { term: { status: 'active' } }],
          },
        },
        _source: [
          'groupId',
          'communityId',
          'name',
          'description',
          'slug',
          'avatar',
          'coverUrl',
          'category',
          'memberCount',
          'type',
        ],
        track_total_hits: true,
      });

      let items: ISearchGroupResult[] = result.hits.hits
        .map((hit): ISearchGroupResult | null => {
          const source = hit._source as ISearchGroupResult;
          if (options.userId && !visibleGroupById.has(source.groupId)) return null;
          const visible = visibleGroupById.get(source.groupId);
          return {
            groupId: source.groupId,
            communityId: source.communityId,
            name: visible?.name ?? source.name,
            description:
              typeof (visible as { description?: unknown } | undefined)?.description === 'string'
                ? ((visible as { description?: string }).description ?? null)
                : source.description || null,
            slug: source.slug,
            avatar: source.avatar ?? null,
            coverUrl: source.coverUrl ?? null,
            category: source.category,
            memberCount: visible?.memberCount ?? source.memberCount,
            type: visible?.type ?? source.type,
          };
        })
        .filter((item): item is ISearchGroupResult => item !== null);

      if (options.userId) {
        const existingIds = new Set(items.map((item) => item.groupId));
        const fallbackGroups = visibleGroupConversations
          .filter((conversation) => {
            const description = String(
              (conversation as { description?: unknown }).description ?? '',
            );
            return (
              textMatchesQuery(conversation.name ?? '', options.query) ||
              textMatchesQuery(description, options.query)
            );
          })
          .filter((conversation) => !existingIds.has(conversation.conversationId))
          .map(
            (conversation): ISearchGroupResult => ({
              groupId: conversation.conversationId,
              name: conversation.name ?? 'Nhóm',
              description:
                typeof (conversation as { description?: unknown }).description === 'string'
                  ? ((conversation as { description?: string }).description ?? null)
                  : null,
              memberCount: conversation.memberCount,
              type: conversation.type,
            }),
          );
        items = [...items, ...fallbackGroups].slice(0, pageSize);
      }

      const total =
        typeof result.hits.total === 'number' ? result.hits.total : result.hits.total?.value || 0;
      const totalWithFallback = options.userId ? items.length : Math.max(total, items.length);
      const hasMore = from + pageSize < totalWithFallback;

      return {
        items,
        total: totalWithFallback,
        page,
        pageSize,
        hasMore,
      };
    } catch (error) {
      console.error('Search groups error:', error);
      if (options.userId) {
        try {
          const conversations = await conversationRepository.getConversations(options.userId);
          const items = conversations
            .filter((conversation) => conversation.type === 'group' && !conversation.isDeleted)
            .filter((conversation) => {
              const description = String(
                (conversation as { description?: unknown }).description ?? '',
              );
              return (
                textMatchesQuery(conversation.name ?? '', options.query) ||
                textMatchesQuery(description, options.query)
              );
            })
            .slice(from, from + pageSize)
            .map(
              (conversation): ISearchGroupResult => ({
                groupId: conversation.conversationId,
                name: conversation.name ?? 'Nhóm',
                description:
                  typeof (conversation as { description?: unknown }).description === 'string'
                    ? ((conversation as { description?: string }).description ?? null)
                    : null,
                memberCount: conversation.memberCount,
                type: conversation.type,
              }),
            );
          return { items, total: items.length, page, pageSize, hasMore: false };
        } catch (fallbackError) {
          console.error('Search groups fallback error:', fallbackError);
        }
      }
      return { items: [], total: 0, page, pageSize, hasMore: false };
    }
  },

  searchPosts: async (options: ISearchOptions): Promise<ISearchResult<ISearchPostResult>> => {
    const page = options.page || 1;
    const pageSize = options.pageSize || 20;
    const from = (page - 1) * pageSize;

    try {
      const filter: Array<Record<string, unknown>> = [{ term: { publicationStatus: 'published' } }];

      if (options.tags && options.tags.length > 0) {
        filter.push({ terms: { tags: options.tags } });
      }

      if (options.categories && options.categories.length > 0) {
        filter.push({ terms: { categories: options.categories } });
      }

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
            filter,
          },
        },
        _source: ['postId', 'authorId', 'content', 'type', 'createdAt'],
        track_total_hits: true,
      });

      const items: ISearchPostResult[] = result.hits.hits.map((hit) => {
        const source = hit._source as ISearchPostResult;
        return {
          postId: source.postId,
          authorId: source.authorId,
          content: source.content,
          type: source.type,
          createdAt: source.createdAt,
        };
      });

      const total =
        typeof result.hits.total === 'number' ? result.hits.total : result.hits.total?.value || 0;
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
        searchService.searchUsers({ ...options, pageSize: 5, userId: _userId }),
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

  searchAllChat: async (
    _userId: string,
    options: ISearchOptions,
  ): Promise<ISearchAllChatResult> => {
    // Tìm kiếm tổng hợp cho chat: users, groups, messages
    try {
      const [usersResult, groupsResult, messagesResult] = await Promise.all([
        searchService.searchUsers({ ...options, pageSize: 5, userId: _userId }),
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

  searchUsersByContact: async (
    options: ISearchOptions,
  ): Promise<ISearchResult<ISearchUserResult>> => {
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
                  email: {
                    query: options.query,
                    fuzziness: 'AUTO',
                    operator: 'or',
                  },
                },
              },
              {
                match: {
                  phone: {
                    query: options.query,
                    fuzziness: 'AUTO',
                    operator: 'or',
                  },
                },
              },
              {
                match_phrase_prefix: {
                  email: options.query,
                },
              },
              {
                match_phrase_prefix: {
                  phone: options.query,
                },
              },
            ],
            minimum_should_match: 1,
          },
        },
        _source: ['userId', 'displayName', 'email', 'phone', 'avatar', 'bio'],
        track_total_hits: true,
      });

      let items: ISearchUserResult[] = result.hits.hits.map((hit) => {
        const source = hit._source as ISearchUserResult & { phone?: string };
        return {
          userId: source.userId,
          displayName: source.displayName,
          email: source.email,
          phone: source.phone || null,
          avatar: source.avatar || null,
          bio: source.bio || null,
          isFriend: false,
          friendshipStatus: 'none',
        };
      });

      // ✅ Filter out current user
      if (options.userId) {
        items = items.filter((user) => user.userId !== options.userId);
      }

      // Check friendship status if userId is provided
      if (options.userId) {
        try {
          const userFriendIds = await userRepository.getFriendIds(options.userId, 1000);
          const userFriendIdsSet = new Set(userFriendIds);

          const { received, sent } = await userRepository.getPendingRequests(options.userId);
          const pendingReceivedSet = new Set(received);
          const pendingSentSet = new Set(sent);

          items = items.map((user) => ({
            ...user,
            isFriend: userFriendIdsSet.has(user.userId),
            friendshipStatus: userFriendIdsSet.has(user.userId)
              ? 'friend'
              : pendingReceivedSet.has(user.userId)
                ? 'pending_received'
                : pendingSentSet.has(user.userId)
                  ? 'pending_sent'
                  : 'none',
          }));
        } catch (error) {
          console.error('Error checking friendships:', error);
          // Keep items with their default 'none' status
        }
      }

      const total =
        typeof result.hits.total === 'number' ? result.hits.total : result.hits.total?.value || 0;
      const hasMore = from + pageSize < total;

      return {
        items,
        total,
        page,
        pageSize,
        hasMore,
      };
    } catch (error) {
      console.error('Search users by contact error:', error);
      return { items: [], total: 0, page, pageSize, hasMore: false };
    }
  },
};
