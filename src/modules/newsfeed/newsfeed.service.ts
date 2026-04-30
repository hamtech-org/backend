import { v4 as uuidv4 } from 'uuid';
import { newsfeedRepository } from './newsfeed.repository.js';
import { userRepository } from '@/modules/user/user.repository.js';
import { getKafkaProducer } from '@/config/kafka.js';
import { KAFKA_TOPICS } from '@/shared/constants/kafkaTopics.js';
import { logger } from '@/shared/utils/logger.js';
import { NotFoundError, ForbiddenError } from '@/shared/utils/errors.js';
import type {
  IPost,
  IComment,
  IReel,
  ICreatePostDto,
  ICreateReelDto,
  IFeedCursorPayload,
  IFeedPage,
  ICommentsCursorPayload,
  ICommentsPage,
} from './newsfeed.types.js';

type ISearchIndexEvent = {
  action: 'index' | 'update' | 'delete';
  indexName: 'posts';
  documentId: string;
  document: Record<string, unknown> | null;
};

const emitPostIndexEvent = async (event: ISearchIndexEvent): Promise<void> => {
  try {
    const producer = getKafkaProducer();
    await producer.send({
      topic: KAFKA_TOPICS.SEARCH_INDEX,
      messages: [
        {
          key: event.documentId,
          value: JSON.stringify({
            action: event.action,
            indexName: event.indexName,
            documentId: event.documentId,
            document: event.document,
          } satisfies ISearchIndexEvent),
        },
      ],
    });
  } catch (error) {
    logger.error(`Emit search.index event failed for post ${event.documentId}:`, error);
  }
};

const comparePostsDesc = (a: IPost, b: IPost): number => {
  const createdDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  if (createdDiff !== 0) return createdDiff;
  return b.postId.localeCompare(a.postId);
};

const encodeFeedCursor = (payload: IFeedCursorPayload): string =>
  Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

const decodeFeedCursor = (cursor?: string): IFeedCursorPayload | null => {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as Partial<IFeedCursorPayload>;
    if (!parsed.createdAt || !parsed.postId) return null;
    return { createdAt: parsed.createdAt, postId: parsed.postId };
  } catch {
    return null;
  }
};

const encodeCommentsCursor = (payload: ICommentsCursorPayload): string =>
  Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

const decodeCommentsCursor = (cursor?: string): ICommentsCursorPayload | null => {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as Partial<ICommentsCursorPayload>;
    if (!parsed.createdAt || !parsed.commentId) return null;
    return { createdAt: parsed.createdAt, commentId: parsed.commentId };
  } catch {
    return null;
  }
};

export const newsfeedService = {
  // Enrich author metadata for UI rendering.
  // Note: this data is not stored in DynamoDB Posts table (it's computed at response time).
  attachAuthorInfo: async (posts: IPost[]): Promise<IPost[]> => {
    const authorIds = Array.from(new Set(posts.map((p) => p.authorId)));
    if (authorIds.length === 0) return posts;

    const users = await userRepository.findMultipleById(authorIds);
    const userMap = new Map(users.map((u) => [u.userId, u]));

    return posts.map((p) => {
      const u = userMap.get(p.authorId);
      if (!u)
        return { ...p, author: { userId: p.authorId, displayName: p.authorId, avatar: null } };
      return {
        ...p,
        author: {
          userId: p.authorId,
          displayName: u.displayName ?? p.authorId,
          avatar: u.avatar ?? null,
        },
      };
    });
  },

  attachCommentAuthorInfo: async (comments: IComment[]): Promise<IComment[]> => {
    const authorIds = Array.from(new Set(comments.map((c) => c.authorId)));
    if (authorIds.length === 0) return comments;

    const users = await userRepository.findMultipleById(authorIds);
    const userMap = new Map(users.map((u) => [u.userId, u]));

    return comments.map((c) => {
      const u = userMap.get(c.authorId);
      if (!u)
        return { ...c, author: { userId: c.authorId, displayName: c.authorId, avatar: null } };
      return {
        ...c,
        author: {
          userId: c.authorId,
          displayName: u.displayName ?? c.authorId,
          avatar: u.avatar ?? null,
        },
      };
    });
  },

  getFeed: async (viewerUserId: string, limit?: number, cursor?: string): Promise<IFeedPage> => {
    const pageSize = Math.max(1, Math.min(limit ?? 20, 50));
    const friendIds = await userRepository.getFriendIds(viewerUserId, 100);
    const friendSet = new Set(friendIds);
    const authorIds = Array.from(new Set([...friendIds, viewerUserId]));
    const decodedCursor = decodeFeedCursor(cursor);

    // MVP: query theo author, merge & sort
    const perAuthorLimit = Math.max(10, pageSize * 3);
    const fetched: IPost[] = [];
    await Promise.all(
      authorIds.map(async (authorId) => {
        const posts = await newsfeedRepository.getPostsByAuthorId(authorId, perAuthorLimit);
        fetched.push(...posts);
      }),
    );

    const uniqueByPostId = new Map<string, IPost>();
    for (const post of fetched) {
      if (!uniqueByPostId.has(post.postId)) {
        uniqueByPostId.set(post.postId, post);
      }
    }

    const visible = Array.from(uniqueByPostId.values())
      .filter((post) => {
        const publicationStatus = post.publicationStatus ?? 'published';
        // Draft: chỉ author thấy
        if (publicationStatus === 'draft') {
          return post.authorId === viewerUserId;
        }

        // Published: áp dụng visibility
        if (post.visibility === 'public') return true;
        if (post.visibility === 'private') return post.authorId === viewerUserId;
        if (post.visibility === 'friends') {
          return post.authorId === viewerUserId || friendSet.has(post.authorId);
        }
        return false;
      })
      .sort(comparePostsDesc)
      .filter((post) => {
        if (!decodedCursor) return true;
        const postCreatedAt = new Date(post.createdAt).getTime();
        const cursorCreatedAt = new Date(decodedCursor.createdAt).getTime();
        if (postCreatedAt < cursorCreatedAt) return true;
        if (postCreatedAt > cursorCreatedAt) return false;
        return post.postId.localeCompare(decodedCursor.postId) < 0;
      });

    const pageSlice = visible.slice(0, pageSize + 1);
    const hasMore = pageSlice.length > pageSize;
    const currentItems = hasMore ? pageSlice.slice(0, pageSize) : pageSlice;
    const enriched = await newsfeedService.attachAuthorInfo(currentItems);
    const lastItem = enriched[enriched.length - 1];
    const nextCursor =
      hasMore && lastItem
        ? encodeFeedCursor({ createdAt: lastItem.createdAt, postId: lastItem.postId })
        : null;

    return {
      items: enriched,
      nextCursor,
      hasMore,
    };
  },

  createPost: async (authorId: string, data: ICreatePostDto): Promise<IPost> => {
    const now = new Date().toISOString();
    const postId = uuidv4();

    const post: IPost = {
      postId,
      authorId,
      content: data.content,
      mediaUrls: data.mediaUrls ?? [],
      type: data.type,
      visibility: data.visibility,
      publicationStatus: data.publicationStatus,
      categories: data.categories ?? [],
      tags: data.tags ?? [],
      reactionsCount: {},
      commentsCount: 0,
      sharesCount: 0,
      viewsCount: 0,
      isModerated: data.publicationStatus === 'published',
      moderationStatus: data.publicationStatus === 'published' ? 'approved' : 'pending',
      createdAt: now,
      updatedAt: now,
    };

    await newsfeedRepository.createPost(post);

    // Chỉ index bài publish để search public hoạt động
    if (post.publicationStatus === 'published') {
      const doc = {
        postId: post.postId,
        authorId: post.authorId,
        content: post.content,
        type: post.type,
        createdAt: post.createdAt,
        visibility: post.visibility,
        publicationStatus: post.publicationStatus,
        tags: post.tags,
        categories: post.categories,
      };

      await emitPostIndexEvent({
        action: 'index',
        indexName: 'posts',
        documentId: post.postId,
        document: doc,
      });
    }

    const enriched = await newsfeedService.attachAuthorInfo([post]);
    return enriched[0];
  },

  getPostById: async (postId: string, viewerUserId: string): Promise<IPost | null> => {
    const post = await newsfeedRepository.getPostById(postId);
    if (!post) return null;

    const publicationStatus = post.publicationStatus ?? 'published';

    if (publicationStatus === 'draft') {
      if (post.authorId !== viewerUserId) return null;
      const enriched = await newsfeedService.attachAuthorInfo([post]);
      return enriched[0];
    }

    if (post.visibility === 'public')
      return newsfeedService.attachAuthorInfo([post]).then((x) => x[0]);
    if (post.visibility === 'private') {
      if (post.authorId !== viewerUserId) return null;
      return newsfeedService.attachAuthorInfo([post]).then((x) => x[0]);
    }
    if (post.visibility === 'friends') {
      if (post.authorId === viewerUserId)
        return newsfeedService.attachAuthorInfo([post]).then((x) => x[0]);
      const friendIds = await userRepository.getFriendIds(viewerUserId, 100);
      if (friendIds.includes(post.authorId))
        return newsfeedService.attachAuthorInfo([post]).then((x) => x[0]);
      return null;
    }

    return null;
  },

  updatePost: async (
    postId: string,
    authorId: string,
    data: Partial<ICreatePostDto>,
  ): Promise<void> => {
    const existing = await newsfeedRepository.getPostById(postId);
    if (!existing) throw new NotFoundError('Bài viết');
    if (existing.authorId !== authorId)
      throw new ForbiddenError('Không có quyền chỉnh sửa bài viết');

    const existingPublicationStatus = existing.publicationStatus ?? 'published';
    const nextPublicationStatus = data.publicationStatus ?? existingPublicationStatus;
    const wasPublished = existingPublicationStatus === 'published';
    const willBePublished = nextPublicationStatus === 'published';

    const updates: Partial<IPost> = {};
    if (data.content !== undefined) updates.content = data.content;
    if (data.visibility !== undefined) updates.visibility = data.visibility;
    if (data.publicationStatus !== undefined) updates.publicationStatus = data.publicationStatus;
    if (data.categories !== undefined) updates.categories = data.categories;
    if (data.tags !== undefined) updates.tags = data.tags;
    if (data.type !== undefined) updates.type = data.type;
    if (data.mediaUrls !== undefined) updates.mediaUrls = data.mediaUrls;

    await newsfeedRepository.updatePost(postId, updates);

    const nextPost: IPost = {
      ...existing,
      ...updates,
      categories: updates.categories ?? existing.categories ?? [],
      tags: updates.tags ?? existing.tags ?? [],
      publicationStatus: updates.publicationStatus ?? existingPublicationStatus,
      updatedAt: new Date().toISOString(),
    };

    if (wasPublished && !willBePublished) {
      await emitPostIndexEvent({
        action: 'delete',
        indexName: 'posts',
        documentId: postId,
        document: null,
      });
    } else if (!wasPublished && willBePublished) {
      const doc = {
        postId: nextPost.postId,
        authorId: nextPost.authorId,
        content: nextPost.content,
        type: nextPost.type,
        createdAt: nextPost.createdAt,
        visibility: nextPost.visibility,
        publicationStatus: nextPost.publicationStatus,
        tags: nextPost.tags,
        categories: nextPost.categories,
      };

      await emitPostIndexEvent({
        action: 'index',
        indexName: 'posts',
        documentId: postId,
        document: doc,
      });
    } else if (willBePublished) {
      const doc = {
        postId: nextPost.postId,
        authorId: nextPost.authorId,
        content: nextPost.content,
        type: nextPost.type,
        createdAt: nextPost.createdAt,
        visibility: nextPost.visibility,
        publicationStatus: nextPost.publicationStatus,
        tags: nextPost.tags,
        categories: nextPost.categories,
      };

      await emitPostIndexEvent({
        action: 'update',
        indexName: 'posts',
        documentId: postId,
        document: doc,
      });
    }
  },

  deletePost: async (postId: string, authorId: string): Promise<void> => {
    const existing = await newsfeedRepository.getPostById(postId);
    if (!existing) throw new NotFoundError('Bài viết');
    if (existing.authorId !== authorId) throw new ForbiddenError('Không có quyền xóa bài viết');

    await newsfeedRepository.deleteCommentsByPostId(postId);
    await newsfeedRepository.deleteReactionsByPostId(postId);
    await newsfeedRepository.deletePost(postId);

    const publicationStatus = existing.publicationStatus ?? 'published';
    if (publicationStatus === 'published') {
      await emitPostIndexEvent({
        action: 'delete',
        indexName: 'posts',
        documentId: postId,
        document: null,
      });
    }
  },

  reactToPost: async (postId: string, userId: string, type: string): Promise<void> => {
    const post = await newsfeedRepository.getPostById(postId);
    if (!post) throw new NotFoundError('Bài viết');

    // Reaction chỉ cho người có quyền xem post
    const canView = await newsfeedService.getPostById(postId, userId);
    if (!canView) throw new ForbiddenError('Không có quyền thao tác trên bài viết');

    const existingReaction = await newsfeedRepository.getReaction(postId, userId);
    const oldType = existingReaction?.type ?? null;

    // If same reaction, MVP: không cập nhật
    if (oldType === type) return;

    const reactionsCount = { ...(post.reactionsCount ?? {}) };
    if (oldType) {
      reactionsCount[oldType] = Math.max(0, (reactionsCount[oldType] ?? 0) - 1);
    }
    reactionsCount[type] = (reactionsCount[type] ?? 0) + 1;

    await newsfeedRepository.upsertReaction(postId, userId, type);
    await newsfeedRepository.updatePost(postId, { reactionsCount });
  },

  getComments: async (
    postId: string,
    viewerUserId: string,
    limit?: number,
    cursor?: string,
  ): Promise<ICommentsPage> => {
    const visiblePost = await newsfeedService.getPostById(postId, viewerUserId);
    if (!visiblePost) throw new NotFoundError('Bài viết');

    const pageSize = Math.max(1, Math.min(limit ?? 5, 20));
    const decodedCursor = decodeCommentsCursor(cursor);
    const pageResult = await newsfeedRepository.getCommentsByPostId(
      postId,
      pageSize,
      decodedCursor,
    );
    const enriched = await newsfeedService.attachCommentAuthorInfo(pageResult.items);
    const lastKey = pageResult.lastEvaluatedKey;
    const hasMore = Boolean(lastKey?.SK);
    const nextCursor =
      hasMore && typeof lastKey?.SK === 'string'
        ? (() => {
            const parts = lastKey.SK.replace('CMT#', '').split('#');
            if (parts.length < 2) return null;
            const commentId = parts[parts.length - 1];
            const createdAt = parts.slice(0, -1).join('#');
            return encodeCommentsCursor({ createdAt, commentId });
          })()
        : null;

    return {
      items: enriched,
      hasMore,
      nextCursor,
    };
  },

  addComment: async (
    postId: string,
    authorId: string,
    content: string,
    parentId?: string,
  ): Promise<IComment> => {
    const post = await newsfeedRepository.getPostById(postId);
    if (!post) throw new NotFoundError('Bài viết');

    // Kiểm tra quyền xem bài (giữ logic đồng nhất với getPostById)
    const visiblePost = await newsfeedService.getPostById(postId, authorId);
    if (!visiblePost) throw new ForbiddenError('Không có quyền bình luận');

    const now = new Date().toISOString();
    const commentId = uuidv4();

    const comment: IComment = {
      commentId,
      postId,
      authorId,
      content,
      parentId: parentId ?? null,
      reactionsCount: {},
      createdAt: now,
      updatedAt: now,
    };

    await newsfeedRepository.createComment(postId, comment);
    const nextCommentsCount = (post.commentsCount ?? 0) + 1;
    await newsfeedRepository.updatePost(postId, { commentsCount: nextCommentsCount });

    const enriched = await newsfeedService.attachCommentAuthorInfo([comment]);
    return enriched[0];
  },

  createReel: async (_authorId: string, _data: ICreateReelDto): Promise<IReel> => {
    // TODO: Tạo reel mới
    throw new Error('Chưa triển khai');
  },

  getReels: async (_limit?: number): Promise<IReel[]> => {
    // TODO: Lấy danh sách reels theo thuật toán đề xuất
    return [];
  },
};
