import { v4 as uuidv4 } from 'uuid';
import { newsfeedRepository, buildReactionSummary } from './newsfeed.repository.js';
import { userRepository } from '@/modules/user/user.repository.js';
import { mediaService } from '@/modules/media/media.service.js';
import { getKafkaProducer } from '@/config/kafka.js';
import { getRedis } from '@/config/redis.js';
import { KAFKA_TOPICS } from '@/shared/constants/kafkaTopics.js';
import { logger } from '@/shared/utils/logger.js';
import { NotFoundError, ForbiddenError, ValidationError } from '@/shared/utils/errors.js';
import { extractHashtagsFromText, extractMentionsFromText } from '@/shared/utils/hashtags.js';
import { getIO } from '@/socket/index.js';
import type {
  IPost,
  IComment,
  IReel,
  ReactionType,
  IReactionSummary,
  ICreatePostDto,
  ICreateReelDto,
  IFeedCursorPayload,
  IFeedPage,
  ICommentsCursorPayload,
  ICommentsPage,
  ISharePostDto,
  ISavedPostsPage,
  ISharedPostInfo,
  IReelFeedPage,
  IReelFeedCursorPayload,
  ReelFeedKind,
  IReportReelDto,
} from './newsfeed.types.js';

type ISearchIndexEvent = {
  action: 'index' | 'update' | 'delete';
  indexName: 'posts' | 'reels';
  documentId: string;
  document: Record<string, unknown> | null;
};

const REEL_FORYOU_FETCH_SIZE = 200;
const REEL_VIEW_DEDUP_TTL_SEC = 24 * 60 * 60;

const encodeReelCursor = (payload: IReelFeedCursorPayload): string =>
  Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

const decodeReelCursor = (cursor?: string): IReelFeedCursorPayload | null => {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as Partial<IReelFeedCursorPayload>;
    if (!parsed.sortKey || !parsed.reelId) return null;
    return { sortKey: parsed.sortKey, reelId: parsed.reelId };
  } catch {
    return null;
  }
};

const computeReelEngagementScore = (reel: IReel, now: number): number => {
  const totalReactions = Object.values(reel.reactionsCount ?? {}).reduce((a, b) => a + (b ?? 0), 0);
  const ageHours = Math.max(0, (now - new Date(reel.createdAt).getTime()) / 3_600_000);
  const recency = Math.pow(0.5, ageHours / 24);
  return (
    0.5 * Math.log1p(totalReactions) +
    0.3 * Math.log1p(reel.commentsCount ?? 0) +
    0.2 * 10 * recency
  );
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

  attachCurrentUserReaction: async (posts: IPost[], viewerUserId: string): Promise<IPost[]> => {
    if (posts.length === 0) return posts;
    const enriched = await Promise.all(
      posts.map(async (post) => {
        const reaction = await newsfeedRepository.getReaction(post.postId, viewerUserId);
        return {
          ...post,
          currentUserReaction: (reaction?.type as ReactionType) ?? null,
        };
      }),
    );
    return enriched;
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

  attachCommentCurrentUserReaction: async (
    comments: IComment[],
    viewerUserId: string,
  ): Promise<IComment[]> => {
    if (comments.length === 0) return comments;
    return Promise.all(
      comments.map(async (c) => {
        const reaction = await newsfeedRepository.getCommentReaction(c.commentId, viewerUserId);
        return { ...c, currentUserReaction: (reaction?.type as ReactionType) ?? null };
      }),
    );
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
    const enrichedAuthors = await newsfeedService.attachAuthorInfo(currentItems);
    const enrichedReactions = await newsfeedService.attachCurrentUserReaction(
      enrichedAuthors,
      viewerUserId,
    );
    const enrichedSaved = await newsfeedService.attachSavedStatus(enrichedReactions, viewerUserId);
    const enriched = await newsfeedService.attachSharedFromAuthorInfo(enrichedSaved);
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

    const enrich = async (p: IPost): Promise<IPost> => {
      const [withAuthor] = await newsfeedService.attachAuthorInfo([p]);
      const [withReaction] = await newsfeedService.attachCurrentUserReaction(
        [withAuthor],
        viewerUserId,
      );
      const [withShared] = await newsfeedService.attachSharedFromAuthorInfo([withReaction]);
      return withShared;
    };

    const publicationStatus = post.publicationStatus ?? 'published';

    if (publicationStatus === 'draft') {
      if (post.authorId !== viewerUserId) return null;
      return enrich(post);
    }

    if (post.visibility === 'public') return enrich(post);

    if (post.visibility === 'private') {
      if (post.authorId !== viewerUserId) return null;
      return enrich(post);
    }

    if (post.visibility === 'friends') {
      if (post.authorId === viewerUserId) return enrich(post);
      const friendIds = await userRepository.getFriendIds(viewerUserId, 100);
      if (friendIds.includes(post.authorId)) return enrich(post);
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

  reactToPost: async (
    postId: string,
    userId: string,
    type: ReactionType,
  ): Promise<IReactionSummary> => {
    const post = await newsfeedRepository.getPostById(postId);
    if (!post) throw new NotFoundError('Bài viết');

    // Reaction chỉ cho người có quyền xem post
    const canView = await newsfeedService.getPostById(postId, userId);
    if (!canView) throw new ForbiddenError('Không có quyền thao tác trên bài viết');

    const existingReaction = await newsfeedRepository.getReaction(postId, userId);
    const oldType = existingReaction?.type ?? null;

    const nextReactionsCount = { ...(post.reactionsCount ?? {}) };
    let nextUserReaction: ReactionType | null = type;

    if (oldType === type) {
      nextReactionsCount[type as ReactionType] = Math.max(
        0,
        (nextReactionsCount[type as ReactionType] ?? 0) - 1,
      );
      await newsfeedRepository.deleteReaction(postId, userId);
      await newsfeedRepository.updatePost(postId, { reactionsCount: nextReactionsCount });
      nextUserReaction = null;
    } else {
      if (oldType) {
        nextReactionsCount[oldType as ReactionType] = Math.max(
          0,
          (nextReactionsCount[oldType as ReactionType] ?? 0) - 1,
        );
      }
      nextReactionsCount[type as ReactionType] =
        (nextReactionsCount[type as ReactionType] ?? 0) + 1;
      await newsfeedRepository.upsertReaction(postId, userId, type);
      await newsfeedRepository.updatePost(postId, { reactionsCount: nextReactionsCount });
    }

    const summary = buildReactionSummary(nextReactionsCount, nextUserReaction);
    try {
      getIO().to(`post:${postId}`).emit('newsfeed:post_reacted', {
        targetId: postId,
        targetType: 'post',
        userId,
        reactionType: nextUserReaction,
        summary,
      });
    } catch (err) {
      logger.error('Failed to emit newsfeed:post_reacted', err);
    }
    return summary;
  },

  getComments: async (
    postId: string,
    viewerUserId: string,
    limit?: number,
    cursor?: string,
    parentId?: string | null, // null = top-level only, string = replies of that parent
  ): Promise<ICommentsPage> => {
    const visiblePost = await newsfeedService.getPostById(postId, viewerUserId);
    if (!visiblePost) throw new NotFoundError('Bài viết');

    const pageSize = Math.max(1, Math.min(limit ?? 5, 20));
    const decodedCursor = decodeCommentsCursor(cursor);
    const pageResult = await newsfeedRepository.getCommentsByPostId(
      postId,
      pageSize,
      decodedCursor,
      parentId ?? null, // default to top-level when not specified
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
    content: string | undefined,
    parentId?: string,
    mediaUrls?: string[],
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
      content: content ?? '',
      ...(mediaUrls?.length ? { mediaUrls } : {}),
      parentId: parentId ?? null,
      reactionsCount: {},
      createdAt: now,
      updatedAt: now,
    };

    await newsfeedRepository.createComment(postId, comment);
    const nextCommentsCount = (post.commentsCount ?? 0) + 1;
    await newsfeedRepository.updatePost(postId, { commentsCount: nextCommentsCount });

    // Increment parent's repliesCount when this is a reply
    if (parentId) {
      const parentComment = await newsfeedRepository.getCommentById(postId, parentId);
      if (parentComment) {
        await newsfeedRepository.updateComment(postId, parentId, parentComment.createdAt, {
          repliesCount: (parentComment.repliesCount ?? 0) + 1,
        });
      }
    }

    const enriched = await newsfeedService.attachCommentAuthorInfo([comment]);
    return enriched[0];
  },

  attachReelAuthorInfo: async (reels: IReel[]): Promise<IReel[]> => {
    const authorIds = Array.from(new Set(reels.map((r) => r.authorId)));
    if (authorIds.length === 0) return reels;
    const users = await userRepository.findMultipleById(authorIds);
    const userMap = new Map(users.map((u) => [u.userId, u]));
    return reels.map((r) => {
      const u = userMap.get(r.authorId);
      return {
        ...r,
        author: u
          ? {
              userId: r.authorId,
              displayName: u.displayName ?? r.authorId,
              avatar: u.avatar ?? null,
            }
          : { userId: r.authorId, displayName: r.authorId, avatar: null },
      };
    });
  },

  attachReelCurrentUserReaction: async (reels: IReel[], viewerUserId: string): Promise<IReel[]> => {
    if (reels.length === 0) return reels;
    return Promise.all(
      reels.map(async (reel) => {
        const reaction = await newsfeedRepository.getReelReaction(reel.reelId, viewerUserId);
        return { ...reel, currentUserReaction: (reaction?.type as ReactionType) ?? null };
      }),
    );
  },

  attachReelSavedStatus: async (reels: IReel[], viewerUserId: string): Promise<IReel[]> => {
    if (reels.length === 0) return reels;
    const ids = reels.map((r) => r.reelId);
    const savedSet = await newsfeedRepository.getSavedReelIds(viewerUserId, ids);
    return reels.map((r) => ({ ...r, isSaved: savedSet.has(r.reelId) }));
  },

  enrichReels: async (reels: IReel[], viewerUserId: string): Promise<IReel[]> => {
    const withAuthor = await newsfeedService.attachReelAuthorInfo(reels);
    const withReaction = await newsfeedService.attachReelCurrentUserReaction(
      withAuthor,
      viewerUserId,
    );
    return newsfeedService.attachReelSavedStatus(withReaction, viewerUserId);
  },

  createReel: async (authorId: string, data: ICreateReelDto): Promise<IReel> => {
    // Verify the videoUrl points to a media record owned by caller (security)
    const media = await mediaService.resolveMediaFromAppDownloadUrl(data.videoUrl);
    if (!media || !media.mediaType.startsWith('video/')) {
      throw new ValidationError('videoUrl không hợp lệ hoặc không phải video');
    }
    if (media.uploaderId !== authorId) {
      throw new ForbiddenError('Không thể dùng video của người khác');
    }

    const hashtags = extractHashtagsFromText(data.caption);
    const mentions = extractMentionsFromText(data.caption);

    const now = new Date().toISOString();
    const reelId = uuidv4();
    const reel: IReel = {
      reelId,
      authorId,
      videoUrl: data.videoUrl,
      thumbnailUrl: data.thumbnailUrl,
      caption: data.caption,
      durationMs: data.durationMs,
      width: data.width,
      height: data.height,
      aspectRatio: data.aspectRatio ?? '9:16',
      visibility: data.visibility ?? 'public',
      processingStatus: 'ready',
      hashtags,
      mentions,
      viewsCount: 0,
      reactionsCount: {},
      commentsCount: 0,
      sharesCount: 0,
      savesCount: 0,
      engagementScore: 0,
      createdAt: now,
      updatedAt: now,
    };

    await newsfeedRepository.createReel(reel);

    if (reel.visibility === 'public') {
      await emitPostIndexEvent({
        action: 'index',
        indexName: 'reels',
        documentId: reelId,
        document: {
          reelId,
          authorId,
          caption: reel.caption,
          hashtags: reel.hashtags,
          createdAt: now,
          visibility: reel.visibility,
        },
      });
    }

    // Broadcast reel:new to followers
    try {
      const followerIds = await userRepository.getFriendIds(authorId, 200);
      const io = getIO();
      for (const followerId of followerIds) {
        io.to(`user:${followerId}`).emit('newsfeed:reel_new', {
          reelId,
          authorId,
        });
      }
    } catch (err) {
      logger.error('Failed to emit newsfeed:reel_new', err);
    }

    const [enriched] = await newsfeedService.attachReelAuthorInfo([reel]);
    return enriched;
  },

  getReelById: async (reelId: string, viewerUserId: string): Promise<IReel | null> => {
    const reel = await newsfeedRepository.getReelById(reelId);
    if (!reel) return null;

    const visibility = reel.visibility ?? 'public';
    if (visibility === 'private' && reel.authorId !== viewerUserId) return null;
    if (visibility === 'friends' && reel.authorId !== viewerUserId) {
      const friendIds = await userRepository.getFriendIds(viewerUserId, 200);
      if (!friendIds.includes(reel.authorId)) return null;
    }

    const [enriched] = await newsfeedService.enrichReels([reel], viewerUserId);
    return enriched;
  },

  getReelsFeed: async (
    viewerUserId: string,
    feed: ReelFeedKind = 'foryou',
    limit?: number,
    cursor?: string,
  ): Promise<IReelFeedPage> => {
    const pageSize = Math.max(1, Math.min(limit ?? 10, 20));
    const decoded = decodeReelCursor(cursor);

    if (feed === 'following') {
      const friendIds = await userRepository.getFriendIds(viewerUserId, 200);
      const authorIds = Array.from(new Set([...friendIds, viewerUserId]));
      const perAuthor = Math.max(10, pageSize * 3);
      const fetched: IReel[] = [];
      await Promise.all(
        authorIds.map(async (aid) => {
          const { items } = await newsfeedRepository.listReelsByAuthor(aid, perAuthor);
          fetched.push(...items);
        }),
      );

      const cursorTime = decoded ? new Date(decoded.sortKey).getTime() : null;
      const sorted = fetched
        .filter((r) => (r.visibility ?? 'public') !== 'private' || r.authorId === viewerUserId)
        .sort((a, b) => {
          const t = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          return t !== 0 ? t : b.reelId.localeCompare(a.reelId);
        })
        .filter((r) => {
          if (!decoded || cursorTime === null) return true;
          const t = new Date(r.createdAt).getTime();
          if (t < cursorTime) return true;
          if (t > cursorTime) return false;
          return r.reelId.localeCompare(decoded.reelId) < 0;
        });

      const slice = sorted.slice(0, pageSize + 1);
      const hasMore = slice.length > pageSize;
      const items = hasMore ? slice.slice(0, pageSize) : slice;
      const enriched = await newsfeedService.enrichReels(items, viewerUserId);
      const last = enriched[enriched.length - 1];
      const nextCursor =
        hasMore && last ? encodeReelCursor({ sortKey: last.createdAt, reelId: last.reelId }) : null;
      return { items: enriched, nextCursor, hasMore };
    }

    // For-you: fetch recent reels, score, paginate with score-based cursor
    const { items: recentRaw } = await newsfeedRepository.listRecentReels(REEL_FORYOU_FETCH_SIZE);
    const friendIds = new Set(await userRepository.getFriendIds(viewerUserId, 200));
    const visibleRaw = recentRaw.filter((r) => {
      const v = r.visibility ?? 'public';
      if (v === 'public') return true;
      if (v === 'private') return r.authorId === viewerUserId;
      return r.authorId === viewerUserId || friendIds.has(r.authorId);
    });

    const now = Date.now();
    const scored = visibleRaw
      .map((r) => ({ reel: r, score: computeReelEngagementScore(r, now) }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.reel.reelId.localeCompare(a.reel.reelId);
      });

    const cursorScore = decoded ? Number(decoded.sortKey) : null;
    const filtered = scored.filter(({ reel, score }) => {
      if (!decoded || cursorScore === null || Number.isNaN(cursorScore)) return true;
      if (score < cursorScore) return true;
      if (score > cursorScore) return false;
      return reel.reelId.localeCompare(decoded.reelId) < 0;
    });

    const slice = filtered.slice(0, pageSize + 1);
    const hasMore = slice.length > pageSize;
    const items = (hasMore ? slice.slice(0, pageSize) : slice).map((s) => s.reel);
    const enriched = await newsfeedService.enrichReels(items, viewerUserId);
    const lastEntry = filtered[items.length - 1];
    const nextCursor =
      hasMore && lastEntry
        ? encodeReelCursor({ sortKey: String(lastEntry.score), reelId: lastEntry.reel.reelId })
        : null;
    return { items: enriched, nextCursor, hasMore };
  },

  deleteReel: async (reelId: string, authorId: string): Promise<void> => {
    const reel = await newsfeedRepository.getReelById(reelId);
    if (!reel) throw new NotFoundError('Reel');
    if (reel.authorId !== authorId) throw new ForbiddenError('Không có quyền xóa reel');

    await newsfeedRepository.deleteCommentsByReelId(reelId);
    await newsfeedRepository.deleteReactionsByReelId(reelId);
    await newsfeedRepository.deleteReel(reelId);

    await emitPostIndexEvent({
      action: 'delete',
      indexName: 'reels',
      documentId: reelId,
      document: null,
    });

    try {
      getIO().emit('newsfeed:reel_deleted', { reelId });
    } catch (err) {
      logger.error('Failed to emit newsfeed:reel_deleted', err);
    }
  },

  recordReelView: async (
    reelId: string,
    viewerUserId: string,
    watchedMs: number,
    completed?: boolean,
  ): Promise<void> => {
    const reel = await newsfeedRepository.getReelById(reelId);
    if (!reel) throw new NotFoundError('Reel');

    // Don't count views from author themselves
    if (reel.authorId === viewerUserId) return;

    // Require >2s watched to count
    if (watchedMs < 2000) return;

    // Debounce 1 view / user / reel / 24h via Redis
    try {
      const redis = getRedis();
      const key = `reel:view:${reelId}:${viewerUserId}`;
      const set = await redis.set(key, '1', 'EX', REEL_VIEW_DEDUP_TTL_SEC, 'NX');
      if (set !== 'OK') return; // already counted
    } catch (err) {
      logger.error('Redis unavailable for reel view dedup', err);
      // Fail-open: do not block view counting if Redis is down
    }

    await newsfeedRepository.incrementReelCounter(reelId, 'viewsCount', 1);
    void completed;
  },

  toggleSaveReel: async (reelId: string, userId: string): Promise<{ isSaved: boolean }> => {
    const reel = await newsfeedRepository.getReelById(reelId);
    if (!reel) throw new NotFoundError('Reel');
    const canView = await newsfeedService.getReelById(reelId, userId);
    if (!canView) throw new ForbiddenError('Không có quyền thao tác reel này');

    const already = await newsfeedRepository.isReelSaved(userId, reelId);
    if (already) {
      await newsfeedRepository.unsaveReel(userId, reelId);
      await newsfeedRepository.incrementReelCounter(reelId, 'savesCount', -1);
      return { isSaved: false };
    }
    await newsfeedRepository.saveReel(userId, reelId);
    await newsfeedRepository.incrementReelCounter(reelId, 'savesCount', 1);
    return { isSaved: true };
  },

  reportReel: async (reelId: string, reporterId: string, dto: IReportReelDto): Promise<void> => {
    const reel = await newsfeedRepository.getReelById(reelId);
    if (!reel) throw new NotFoundError('Reel');
    await newsfeedRepository.createReport({
      reportId: uuidv4(),
      entityType: 'REEL',
      entityId: reelId,
      reporterId,
      reason: dto.reason,
      details: dto.details,
      createdAt: new Date().toISOString(),
    });
  },

  getReelComments: async (
    reelId: string,
    viewerUserId: string,
    limit?: number,
    cursor?: string,
    parentId?: string | null,
  ): Promise<ICommentsPage> => {
    const visible = await newsfeedService.getReelById(reelId, viewerUserId);
    if (!visible) throw new NotFoundError('Reel');

    const pageSize = Math.max(1, Math.min(limit ?? 5, 20));
    const decoded = decodeCommentsCursor(cursor);
    const result = await newsfeedRepository.getCommentsByReelId(
      reelId,
      pageSize,
      decoded,
      parentId ?? null,
    );
    const withAuthors = await newsfeedService.attachCommentAuthorInfo(result.items);
    const enriched = await newsfeedService.attachCommentCurrentUserReaction(
      withAuthors,
      viewerUserId,
    );
    const lastKey = result.lastEvaluatedKey;
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
    return { items: enriched, nextCursor, hasMore };
  },

  addReelComment: async (
    reelId: string,
    authorId: string,
    content: string | undefined,
    parentId?: string,
    mediaUrls?: string[],
  ): Promise<IComment> => {
    const visible = await newsfeedService.getReelById(reelId, authorId);
    if (!visible) throw new ForbiddenError('Không có quyền bình luận');

    const now = new Date().toISOString();
    const commentId = uuidv4();
    const comment: IComment = {
      commentId,
      postId: reelId, // reuse field name; semantically references the reel
      authorId,
      content: content ?? '',
      ...(mediaUrls?.length ? { mediaUrls } : {}),
      parentId: parentId ?? null,
      reactionsCount: {},
      createdAt: now,
      updatedAt: now,
    };

    await newsfeedRepository.createReelComment(reelId, comment);
    await newsfeedRepository.incrementReelCounter(reelId, 'commentsCount', 1);

    if (parentId) {
      const parent = await newsfeedRepository.getReelCommentById(reelId, parentId);
      if (parent) {
        await newsfeedRepository.updateReelComment(reelId, parentId, parent.createdAt, {
          repliesCount: (parent.repliesCount ?? 0) + 1,
        });
      }
    }

    try {
      getIO()
        .to(`reel:${reelId}`)
        .emit('newsfeed:reel_commented', {
          reelId,
          comment: { commentId, authorId, content: comment.content, createdAt: now },
        });
    } catch (err) {
      logger.error('Failed to emit newsfeed:reel_commented', err);
    }

    const [enriched] = await newsfeedService.attachCommentAuthorInfo([comment]);
    return enriched;
  },

  getReelsByAuthor: async (
    authorId: string,
    viewerUserId: string,
    limit?: number,
  ): Promise<IReel[]> => {
    const pageSize = Math.max(1, Math.min(limit ?? 20, 50));
    const { items } = await newsfeedRepository.listReelsByAuthor(authorId, pageSize);
    const hasFriendsReels = items.some(
      (r) => (r.visibility ?? 'public') === 'friends' && r.authorId !== viewerUserId,
    );
    const isFriendOfAuthor = hasFriendsReels
      ? (await userRepository.getFriendIds(viewerUserId, 200)).includes(authorId)
      : false;

    const visible = items.filter((r) => {
      const v = r.visibility ?? 'public';
      if (v === 'public') return true;
      if (v === 'private') return r.authorId === viewerUserId;
      return r.authorId === viewerUserId || isFriendOfAuthor;
    });
    return newsfeedService.enrichReels(visible, viewerUserId);
  },

  reactToComment: async (
    postId: string,
    commentId: string,
    userId: string,
    type: ReactionType,
  ): Promise<IReactionSummary> => {
    const post = await newsfeedRepository.getPostById(postId);
    if (!post) throw new NotFoundError('Bài viết');
    const canView = await newsfeedService.getPostById(postId, userId);
    if (!canView) throw new ForbiddenError('Không có quyền thao tác trên bài viết');

    const comment = await newsfeedRepository.getCommentById(postId, commentId);
    if (!comment) throw new NotFoundError('Bình luận');

    const existingReaction = await newsfeedRepository.getCommentReaction(commentId, userId);
    const oldType = existingReaction?.type ?? null;

    const nextReactionsCount = { ...(comment.reactionsCount ?? {}) };
    let nextUserReaction: ReactionType | null = type;

    if (oldType === type) {
      nextReactionsCount[type] = Math.max(0, (nextReactionsCount[type] ?? 0) - 1);
      await newsfeedRepository.deleteCommentReaction(commentId, userId);
      await newsfeedRepository.updateComment(postId, commentId, comment.createdAt, {
        reactionsCount: nextReactionsCount,
      });
      nextUserReaction = null;
    } else {
      if (oldType) {
        nextReactionsCount[oldType] = Math.max(0, (nextReactionsCount[oldType] ?? 0) - 1);
      }
      nextReactionsCount[type] = (nextReactionsCount[type] ?? 0) + 1;
      await newsfeedRepository.upsertCommentReaction(commentId, userId, type);
      await newsfeedRepository.updateComment(postId, commentId, comment.createdAt, {
        reactionsCount: nextReactionsCount,
      });
    }

    const summary = buildReactionSummary(nextReactionsCount, nextUserReaction);
    try {
      getIO().to(`post:${postId}`).emit('newsfeed:comment_reacted', {
        targetId: commentId,
        targetType: 'comment',
        postId,
        userId,
        reactionType: nextUserReaction,
        summary,
      });
    } catch (err) {
      logger.error('Failed to emit newsfeed:comment_reacted', err);
    }
    return summary;
  },

  attachSavedStatus: async (posts: IPost[], viewerUserId: string): Promise<IPost[]> => {
    if (posts.length === 0) return posts;
    const postIds = posts.map((p) => p.postId);
    const savedIds = await newsfeedRepository.getSavedPostIds(viewerUserId, postIds);
    return posts.map((p) => ({ ...p, isSaved: savedIds.has(p.postId) }));
  },

  attachSharedFromAuthorInfo: async (posts: IPost[]): Promise<IPost[]> => {
    const needEnrich = posts.filter((p) => p.sharedFrom && !p.sharedFrom.author);
    if (needEnrich.length === 0) return posts;
    const authorIds = Array.from(new Set(needEnrich.map((p) => p.sharedFrom!.authorId)));
    const users = await userRepository.findMultipleById(authorIds);
    const userMap = new Map(users.map((u) => [u.userId, u]));
    return posts.map((p) => {
      if (!p.sharedFrom || p.sharedFrom.author) return p;
      const u = userMap.get(p.sharedFrom.authorId);
      return {
        ...p,
        sharedFrom: {
          ...p.sharedFrom,
          author: u
            ? { userId: u.userId, displayName: u.displayName ?? u.userId, avatar: u.avatar ?? null }
            : { userId: p.sharedFrom.authorId, displayName: p.sharedFrom.authorId, avatar: null },
        },
      };
    });
  },

  sharePost: async (originalPostId: string, userId: string, dto: ISharePostDto): Promise<IPost> => {
    const original = await newsfeedRepository.getPostById(originalPostId);
    if (!original) throw new NotFoundError('Bài viết');

    // Chỉ chia sẻ bài public hoặc friends (không chia sẻ private)
    if (original.visibility === 'private' && original.authorId !== userId) {
      throw new ForbiddenError('Không thể chia sẻ bài viết riêng tư');
    }
    if (original.publicationStatus === 'draft') {
      throw new ForbiddenError('Không thể chia sẻ bài viết nháp');
    }

    // Fetch author của bài gốc trước để lưu snapshot vào DB
    const originalAuthorUsers = await userRepository.findMultipleById([original.authorId]);
    const originalUser = originalAuthorUsers[0];

    const sharedFrom: ISharedPostInfo = {
      postId: original.postId,
      authorId: original.authorId,
      content: original.content,
      mediaUrls: original.mediaUrls,
      type: original.type,
      createdAt: original.createdAt,
      // Lưu author snapshot vào DB ngay khi tạo
      author: originalUser
        ? {
            userId: originalUser.userId,
            displayName: originalUser.displayName ?? originalUser.userId,
            avatar: originalUser.avatar ?? null,
          }
        : undefined,
    };

    const now = new Date().toISOString();
    const postId = uuidv4();
    const newPost: IPost = {
      postId,
      authorId: userId,
      content: dto.content ?? '',
      mediaUrls: [],
      type: 'text',
      visibility: dto.visibility ?? original.visibility,
      publicationStatus: 'published',
      categories: [],
      tags: [],
      reactionsCount: {},
      commentsCount: 0,
      sharesCount: 0,
      viewsCount: 0,
      isModerated: true,
      moderationStatus: 'approved',
      sharedFrom,
      createdAt: now,
      updatedAt: now,
    };

    await newsfeedRepository.createPost(newPost);
    await newsfeedRepository.incrementSharesCount(originalPostId);

    await emitPostIndexEvent({
      action: 'index',
      indexName: 'posts',
      documentId: postId,
      document: {
        postId,
        authorId: userId,
        content: newPost.content,
        type: newPost.type,
        createdAt: now,
        visibility: newPost.visibility,
        publicationStatus: 'published',
        tags: [],
        categories: [],
      },
    });

    const enriched = await newsfeedService.attachAuthorInfo([newPost]);
    return enriched[0];
  },

  toggleSavePost: async (postId: string, userId: string): Promise<{ isSaved: boolean }> => {
    const post = await newsfeedRepository.getPostById(postId);
    if (!post) throw new NotFoundError('Bài viết');

    const alreadySaved = await newsfeedRepository.getSavedPost(userId, postId);
    if (alreadySaved) {
      await newsfeedRepository.unsavePost(userId, postId);
      return { isSaved: false };
    }
    await newsfeedRepository.savePost(userId, postId);
    return { isSaved: true };
  },

  getSavedPosts: async (
    userId: string,
    limit?: number,
    cursor?: string,
  ): Promise<ISavedPostsPage> => {
    const pageSize = Math.max(1, Math.min(limit ?? 10, 50));
    const { items: savedItems, lastEvaluatedKey } = await newsfeedRepository.getSavedPosts(
      userId,
      pageSize,
      cursor,
    );

    const postIds = savedItems.map((s) => s.postId);
    const posts = await Promise.all(postIds.map((id) => newsfeedRepository.getPostById(id)));

    const postMap = new Map<string, IPost>();
    for (const p of posts) {
      if (p) postMap.set(p.postId, p);
    }

    const validItems = savedItems.filter((s) => postMap.has(s.postId));
    const rawPosts = validItems.map((s) => postMap.get(s.postId)!);
    const enrichedAuthors = await newsfeedService.attachAuthorInfo(rawPosts);
    const enrichedReactions = await newsfeedService.attachCurrentUserReaction(
      enrichedAuthors,
      userId,
    );
    const enrichedWithShared = await newsfeedService.attachSharedFromAuthorInfo(enrichedReactions);

    const enrichedSaved = validItems.map((s, i) => ({
      userId: s.userId,
      postId: s.postId,
      savedAt: s.savedAt,
      post: { ...enrichedWithShared[i], isSaved: true },
    }));

    const hasMore = Boolean(lastEvaluatedKey);
    const nextCursor =
      hasMore && lastEvaluatedKey
        ? Buffer.from(JSON.stringify(lastEvaluatedKey), 'utf8').toString('base64url')
        : null;

    return { items: enrichedSaved, nextCursor, hasMore };
  },

  reactToReel: async (
    reelId: string,
    userId: string,
    type: ReactionType,
  ): Promise<IReactionSummary> => {
    const reel = await newsfeedRepository.getReelById(reelId);
    if (!reel) throw new NotFoundError('Reel');
    const canView = await newsfeedService.getReelById(reelId, userId);
    if (!canView) throw new ForbiddenError('Không có quyền thao tác reel này');

    const existingReaction = await newsfeedRepository.getReelReaction(reelId, userId);
    const oldType = existingReaction?.type ?? null;

    const nextReactionsCount = { ...(reel.reactionsCount ?? {}) };
    let nextUserReaction: ReactionType | null = type;

    if (oldType === type) {
      nextReactionsCount[type] = Math.max(0, (nextReactionsCount[type] ?? 0) - 1);
      await newsfeedRepository.deleteReelReaction(reelId, userId);
      await newsfeedRepository.updateReel(reelId, { reactionsCount: nextReactionsCount });
      nextUserReaction = null;
    } else {
      if (oldType) {
        nextReactionsCount[oldType] = Math.max(0, (nextReactionsCount[oldType] ?? 0) - 1);
      }
      nextReactionsCount[type] = (nextReactionsCount[type] ?? 0) + 1;
      await newsfeedRepository.upsertReelReaction(reelId, userId, type);
      await newsfeedRepository.updateReel(reelId, { reactionsCount: nextReactionsCount });
    }

    const summary = buildReactionSummary(nextReactionsCount, nextUserReaction);
    try {
      getIO().to(`reel:${reelId}`).emit('newsfeed:reel_reacted', {
        targetId: reelId,
        targetType: 'reel',
        userId,
        reactionType: nextUserReaction,
        summary,
      });
    } catch (err) {
      logger.error('Failed to emit newsfeed:reel_reacted', err);
    }
    return summary;
  },

  reactToReelComment: async (
    reelId: string,
    commentId: string,
    userId: string,
    type: ReactionType,
  ): Promise<IReactionSummary> => {
    // Validate reel visibility
    const reel = await newsfeedService.getReelById(reelId, userId);
    if (!reel) throw new NotFoundError('Reel');

    // Lấy comment từ reel comments (PK=REEL#reelId)
    const comment = await newsfeedRepository.getReelCommentById(reelId, commentId);
    if (!comment) throw new NotFoundError('Bình luận');

    const existingReaction = await newsfeedRepository.getCommentReaction(commentId, userId);
    const oldType = existingReaction?.type ?? null;

    const nextReactionsCount = { ...(comment.reactionsCount ?? {}) };
    let nextUserReaction: ReactionType | null = type;

    if (oldType === type) {
      // Toggle off
      nextReactionsCount[type] = Math.max(0, (nextReactionsCount[type] ?? 0) - 1);
      await newsfeedRepository.deleteCommentReaction(commentId, userId);
      await newsfeedRepository.updateReelComment(reelId, commentId, comment.createdAt, {
        reactionsCount: nextReactionsCount,
      });
      nextUserReaction = null;
    } else {
      // Switch or new reaction
      if (oldType) {
        nextReactionsCount[oldType] = Math.max(0, (nextReactionsCount[oldType] ?? 0) - 1);
      }
      nextReactionsCount[type] = (nextReactionsCount[type] ?? 0) + 1;
      await newsfeedRepository.upsertCommentReaction(commentId, userId, type);
      await newsfeedRepository.updateReelComment(reelId, commentId, comment.createdAt, {
        reactionsCount: nextReactionsCount,
      });
    }

    const summary = buildReactionSummary(nextReactionsCount, nextUserReaction);
    try {
      getIO().to(`reel:${reelId}`).emit('newsfeed:reel_comment_reacted', {
        reelId,
        commentId,
        userId,
        reactionType: nextUserReaction,
        summary,
      });
    } catch (err) {
      logger.error('Failed to emit newsfeed:reel_comment_reacted', err);
    }
    return summary;
  },
};
