import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  BatchWriteCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import { env } from '@/config/env.js';
import type { IPost, IComment, IReel, ReactionType, IReactionSummary } from './newsfeed.types.js';

const POSTS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Posts`;
const COMMENTS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Comments`;
const REACTIONS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Reactions`;
const REELS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Reels`;
const SAVED_POSTS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}SavedPosts`;
const REPORTS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Reports`;

/**
 * GSI for global recency on reels.
 * Schema: PK="REEL", SK="{createdAt}#{reelId}"
 * Tradeoff: single hot partition (acceptable for student-scale <10k reels/day).
 */
const REELS_GLOBAL_GSI = 'GSI-2';
const REELS_GLOBAL_PK = 'REEL';

/** Helper: xây dựng IReactionSummary từ reactionsCount map và reaction của viewer */
export const buildReactionSummary = (
  reactionsCount: Partial<Record<ReactionType, number>>,
  userReaction: ReactionType | null,
): IReactionSummary => {
  const counts = reactionsCount as Partial<Record<ReactionType, number>>;
  const total = Object.values(counts).reduce((sum, v) => sum + (v ?? 0), 0);
  const topReactions = (Object.entries(counts) as [ReactionType, number][])
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([k]) => k);
  return { counts, total, userReaction, topReactions };
};

export const newsfeedRepository = {
  getPostsByAuthorId: async (authorId: string, limit: number = 20): Promise<IPost[]> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: POSTS_TABLE,
        IndexName: 'GSI-1',
        KeyConditionExpression: 'authorId = :authorId',
        ExpressionAttributeValues: {
          ':authorId': authorId,
        },
        Limit: limit,
        ScanIndexForward: false, // createdAt desc
      }),
    );

    return (result.Items as IPost[]) ?? [];
  },

  getPostById: async (postId: string): Promise<IPost | null> => {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: POSTS_TABLE,
        Key: { PK: `POST#${postId}`, SK: 'META' },
      }),
    );
    return (result.Item as IPost) ?? null;
  },

  createPost: async (post: IPost): Promise<void> => {
    await dynamoClient.send(
      new PutCommand({
        TableName: POSTS_TABLE,
        Item: { PK: `POST#${post.postId}`, SK: 'META', ...post },
      }),
    );
  },

  updatePost: async (postId: string, updates: Partial<IPost>): Promise<void> => {
    const entries = Object.entries(updates).filter(([, v]) => v !== undefined);
    const updateExpr = entries.map(([,], i) => `#k${i} = :v${i}`).join(', ');

    await dynamoClient.send(
      new UpdateCommand({
        TableName: POSTS_TABLE,
        Key: { PK: `POST#${postId}`, SK: 'META' },
        UpdateExpression: `SET ${updateExpr}, updatedAt = :now`,
        ExpressionAttributeNames: Object.fromEntries(entries.map(([k], i) => [`#k${i}`, k])),
        ExpressionAttributeValues: {
          ...Object.fromEntries(entries.map(([, v], i) => [`:v${i}`, v])),
          ':now': new Date().toISOString(),
        },
      }),
    );
  },

  deletePost: async (postId: string): Promise<void> => {
    await dynamoClient.send(
      new DeleteCommand({
        TableName: POSTS_TABLE,
        Key: { PK: `POST#${postId}`, SK: 'META' },
      }),
    );
  },

  getCommentsByPostId: async (
    postId: string,
    limit: number = 5,
    cursor?: { createdAt: string; commentId: string } | null,
    parentId?: string | null, // null = top-level only, string = replies of that parent
  ): Promise<{ items: IComment[]; lastEvaluatedKey?: Record<string, unknown> }> => {
    const attrValues: Record<string, unknown> = { ':pk': `POST#${postId}` };
    let filterExpr: string | undefined;

    if (parentId === null) {
      filterExpr = 'attribute_not_exists(parentId)';
    } else if (typeof parentId === 'string') {
      filterExpr = 'parentId = :parentId';
      attrValues[':parentId'] = parentId;
    }

    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: COMMENTS_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: attrValues,
        FilterExpression: filterExpr,
        // Overscan to compensate for FilterExpression reducing results
        Limit: limit * 4,
        ScanIndexForward: false,
        ExclusiveStartKey: cursor
          ? {
              PK: `POST#${postId}`,
              SK: `CMT#${cursor.createdAt}#${cursor.commentId}`,
            }
          : undefined,
      }),
    );

    let all = (result.Items as IComment[]) ?? [];

    // App-level fallback filter (handles data stored before the attribute_not_exists fix)
    if (parentId === null) {
      all = all.filter((c) => c.parentId == null);
    } else if (typeof parentId === 'string') {
      all = all.filter((c) => c.parentId === parentId);
    }

    const page = all.slice(0, limit);
    const hasMoreFromOverscan = all.length > limit;

    // Build lastEvaluatedKey: prefer synthetic key from last item so cursor is exact
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    if (hasMoreFromOverscan && page.length > 0) {
      const last = page[page.length - 1];
      lastEvaluatedKey = {
        PK: `POST#${postId}`,
        SK: `CMT#${last.createdAt}#${last.commentId}`,
      };
    } else if (result.LastEvaluatedKey) {
      lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown>;
    }

    return { items: page, lastEvaluatedKey };
  },

  createComment: async (postId: string, comment: IComment): Promise<void> => {
    // Do NOT persist parentId when null — enables attribute_not_exists filter for top-level queries
    const item: Record<string, unknown> = {
      PK: `POST#${postId}`,
      SK: `CMT#${comment.createdAt}#${comment.commentId}`,
      commentId: comment.commentId,
      postId: comment.postId,
      authorId: comment.authorId,
      content: comment.content,
      reactionsCount: comment.reactionsCount,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
    };
    if (comment.parentId) item.parentId = comment.parentId;
    if (comment.repliesCount !== undefined) item.repliesCount = comment.repliesCount;
    if (comment.mediaUrls?.length) item.mediaUrls = comment.mediaUrls;

    await dynamoClient.send(new PutCommand({ TableName: COMMENTS_TABLE, Item: item }));
  },

  deleteCommentsByPostId: async (postId: string): Promise<void> => {
    const commentsRes = await dynamoClient.send(
      new QueryCommand({
        TableName: COMMENTS_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `POST#${postId}`,
        },
        ProjectionExpression: 'PK, SK',
      }),
    );

    const items = commentsRes.Items as Array<{ PK: string; SK: string }> | undefined;
    if (!items || items.length === 0) return;

    // DynamoDB BatchWrite max 25 items per request
    for (let i = 0; i < items.length; i += 25) {
      const chunk = items.slice(i, i + 25);
      await dynamoClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [COMMENTS_TABLE]: chunk.map((x) => ({
              DeleteRequest: {
                Key: { PK: x.PK, SK: x.SK },
              },
            })),
          },
        }),
      );
    }
  },

  getReaction: async (postId: string, userId: string): Promise<{ type: string } | null> => {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: REACTIONS_TABLE,
        Key: { PK: `POST#${postId}`, SK: `REACT#${userId}` },
      }),
    );

    const item = result.Item as { type?: string } | undefined;
    if (!item || !item.type) return null;
    return { type: item.type };
  },

  upsertReaction: async (postId: string, userId: string, type: string): Promise<void> => {
    await dynamoClient.send(
      new PutCommand({
        TableName: REACTIONS_TABLE,
        Item: {
          PK: `POST#${postId}`,
          SK: `REACT#${userId}`,
          postId,
          userId,
          type,
          createdAt: new Date().toISOString(),
        },
      }),
    );
  },

  deleteReaction: async (postId: string, userId: string): Promise<void> => {
    await dynamoClient.send(
      new DeleteCommand({
        TableName: REACTIONS_TABLE,
        Key: { PK: `POST#${postId}`, SK: `REACT#${userId}` },
      }),
    );
  },

  deleteReactionsByPostId: async (postId: string): Promise<void> => {
    const reactionsRes = await dynamoClient.send(
      new QueryCommand({
        TableName: REACTIONS_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `POST#${postId}`,
        },
        ProjectionExpression: 'PK, SK',
      }),
    );

    const items = reactionsRes.Items as Array<{ PK: string; SK: string }> | undefined;
    if (!items || items.length === 0) return;

    for (let i = 0; i < items.length; i += 25) {
      const chunk = items.slice(i, i + 25);
      await dynamoClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [REACTIONS_TABLE]: chunk.map((x) => ({
              DeleteRequest: { Key: { PK: x.PK, SK: x.SK } },
            })),
          },
        }),
      );
    }
  },

  getReelById: async (reelId: string): Promise<IReel | null> => {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: REELS_TABLE,
        Key: { PK: `REEL#${reelId}`, SK: 'META' },
      }),
    );
    return (result.Item as IReel) ?? null;
  },

  createReel: async (reel: IReel): Promise<void> => {
    await dynamoClient.send(
      new PutCommand({
        TableName: REELS_TABLE,
        Item: {
          PK: `REEL#${reel.reelId}`,
          SK: 'META',
          // GSI-2 keys for global recency feed
          GSI2PK: REELS_GLOBAL_PK,
          GSI2SK: `${reel.createdAt}#${reel.reelId}`,
          ...reel,
        },
      }),
    );
  },

  listRecentReels: async (
    limit: number,
    exclusiveStartKey?: Record<string, unknown>,
  ): Promise<{ items: IReel[]; lastEvaluatedKey?: Record<string, unknown> }> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: REELS_TABLE,
        IndexName: REELS_GLOBAL_GSI,
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: { ':pk': REELS_GLOBAL_PK },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    return {
      items: (result.Items as IReel[]) ?? [],
      lastEvaluatedKey: result.LastEvaluatedKey as Record<string, unknown> | undefined,
    };
  },

  listReelsByAuthor: async (
    authorId: string,
    limit: number,
    exclusiveStartKey?: Record<string, unknown>,
  ): Promise<{ items: IReel[]; lastEvaluatedKey?: Record<string, unknown> }> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: REELS_TABLE,
        IndexName: 'GSI-1',
        KeyConditionExpression: 'authorId = :a',
        ExpressionAttributeValues: { ':a': authorId },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    return {
      items: (result.Items as IReel[]) ?? [],
      lastEvaluatedKey: result.LastEvaluatedKey as Record<string, unknown> | undefined,
    };
  },

  incrementReelCounter: async (
    reelId: string,
    field: 'viewsCount' | 'commentsCount' | 'sharesCount' | 'savesCount',
    delta: number,
  ): Promise<void> => {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: REELS_TABLE,
        Key: { PK: `REEL#${reelId}`, SK: 'META' },
        UpdateExpression: `SET #f = if_not_exists(#f, :zero) + :d`,
        ExpressionAttributeNames: { '#f': field },
        ExpressionAttributeValues: { ':d': delta, ':zero': 0 },
      }),
    );
  },

  deleteReel: async (reelId: string): Promise<void> => {
    await dynamoClient.send(
      new DeleteCommand({
        TableName: REELS_TABLE,
        Key: { PK: `REEL#${reelId}`, SK: 'META' },
      }),
    );
  },

  // ─── Reel Comments (mirror Post comments under PK=REEL#{reelId}) ────────────────────

  getCommentsByReelId: async (
    reelId: string,
    limit: number = 5,
    cursor?: { createdAt: string; commentId: string } | null,
    parentId?: string | null,
  ): Promise<{ items: IComment[]; lastEvaluatedKey?: Record<string, unknown> }> => {
    const attrValues: Record<string, unknown> = { ':pk': `REEL#${reelId}` };
    let filterExpr: string | undefined;
    if (parentId === null) {
      filterExpr = 'attribute_not_exists(parentId)';
    } else if (typeof parentId === 'string') {
      filterExpr = 'parentId = :parentId';
      attrValues[':parentId'] = parentId;
    }

    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: COMMENTS_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: attrValues,
        FilterExpression: filterExpr,
        Limit: limit * 4,
        ScanIndexForward: false,
        ExclusiveStartKey: cursor
          ? { PK: `REEL#${reelId}`, SK: `CMT#${cursor.createdAt}#${cursor.commentId}` }
          : undefined,
      }),
    );

    let all = (result.Items as IComment[]) ?? [];
    if (parentId === null) all = all.filter((c) => c.parentId == null);
    else if (typeof parentId === 'string') all = all.filter((c) => c.parentId === parentId);

    const page = all.slice(0, limit);
    const hasMoreFromOverscan = all.length > limit;
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    if (hasMoreFromOverscan && page.length > 0) {
      const last = page[page.length - 1];
      lastEvaluatedKey = {
        PK: `REEL#${reelId}`,
        SK: `CMT#${last.createdAt}#${last.commentId}`,
      };
    } else if (result.LastEvaluatedKey) {
      lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown>;
    }
    return { items: page, lastEvaluatedKey };
  },

  createReelComment: async (reelId: string, comment: IComment): Promise<void> => {
    const item: Record<string, unknown> = {
      PK: `REEL#${reelId}`,
      SK: `CMT#${comment.createdAt}#${comment.commentId}`,
      commentId: comment.commentId,
      reelId,
      authorId: comment.authorId,
      content: comment.content,
      reactionsCount: comment.reactionsCount,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
    };
    if (comment.parentId) item.parentId = comment.parentId;
    if (comment.repliesCount !== undefined) item.repliesCount = comment.repliesCount;
    if (comment.mediaUrls?.length) item.mediaUrls = comment.mediaUrls;
    await dynamoClient.send(new PutCommand({ TableName: COMMENTS_TABLE, Item: item }));
  },

  deleteCommentsByReelId: async (reelId: string): Promise<void> => {
    const res = await dynamoClient.send(
      new QueryCommand({
        TableName: COMMENTS_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `REEL#${reelId}` },
        ProjectionExpression: 'PK, SK',
      }),
    );
    const items = res.Items as Array<{ PK: string; SK: string }> | undefined;
    if (!items?.length) return;
    for (let i = 0; i < items.length; i += 25) {
      const chunk = items.slice(i, i + 25);
      await dynamoClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [COMMENTS_TABLE]: chunk.map((x) => ({
              DeleteRequest: { Key: { PK: x.PK, SK: x.SK } },
            })),
          },
        }),
      );
    }
  },

  deleteReactionsByReelId: async (reelId: string): Promise<void> => {
    const res = await dynamoClient.send(
      new QueryCommand({
        TableName: REACTIONS_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `REEL#${reelId}` },
        ProjectionExpression: 'PK, SK',
      }),
    );
    const items = res.Items as Array<{ PK: string; SK: string }> | undefined;
    if (!items?.length) return;
    for (let i = 0; i < items.length; i += 25) {
      const chunk = items.slice(i, i + 25);
      await dynamoClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [REACTIONS_TABLE]: chunk.map((x) => ({
              DeleteRequest: { Key: { PK: x.PK, SK: x.SK } },
            })),
          },
        }),
      );
    }
  },

  getReelCommentById: async (reelId: string, commentId: string): Promise<IComment | null> => {
    const res = await dynamoClient.send(
      new QueryCommand({
        TableName: COMMENTS_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `REEL#${reelId}`, ':prefix': 'CMT#' },
      }),
    );
    const items = res.Items as IComment[] | undefined;
    return items?.find((c) => c.commentId === commentId) ?? null;
  },

  updateReelComment: async (
    reelId: string,
    commentId: string,
    createdAt: string,
    updates: Partial<IComment>,
  ): Promise<void> => {
    const entries = Object.entries(updates).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return;
    const updateExpr = entries.map(([,], i) => `#k${i} = :v${i}`).join(', ');
    await dynamoClient.send(
      new UpdateCommand({
        TableName: COMMENTS_TABLE,
        Key: { PK: `REEL#${reelId}`, SK: `CMT#${createdAt}#${commentId}` },
        UpdateExpression: `SET ${updateExpr}, updatedAt = :now`,
        ExpressionAttributeNames: Object.fromEntries(entries.map(([k], i) => [`#k${i}`, k])),
        ExpressionAttributeValues: {
          ...Object.fromEntries(entries.map(([, v], i) => [`:v${i}`, v])),
          ':now': new Date().toISOString(),
        },
      }),
    );
  },

  // ─── Reel Saves (reuses SavedPosts table with REEL prefix) ──────────────────────

  saveReel: async (userId: string, reelId: string): Promise<void> => {
    const savedAt = new Date().toISOString();
    await dynamoClient.send(
      new PutCommand({
        TableName: SAVED_POSTS_TABLE,
        Item: {
          PK: `USER#${userId}`,
          SK: `SAVED#REEL#${savedAt}#${reelId}`,
          GSI1SK: `SAVED#REEL#${reelId}`,
          userId,
          reelId,
          entityType: 'REEL',
          savedAt,
        },
      }),
    );
  },

  unsaveReel: async (userId: string, reelId: string): Promise<void> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: SAVED_POSTS_TABLE,
        IndexName: 'GSI-PostLookup',
        KeyConditionExpression: 'PK = :pk AND begins_with(GSI1SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':prefix': `SAVED#REEL#${reelId}`,
        },
        ProjectionExpression: 'PK, SK',
        Limit: 1,
      }),
    );
    const item = result.Items?.[0] as { PK: string; SK: string } | undefined;
    if (!item) return;
    await dynamoClient.send(
      new DeleteCommand({
        TableName: SAVED_POSTS_TABLE,
        Key: { PK: item.PK, SK: item.SK },
      }),
    );
  },

  isReelSaved: async (userId: string, reelId: string): Promise<boolean> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: SAVED_POSTS_TABLE,
        IndexName: 'GSI-PostLookup',
        KeyConditionExpression: 'PK = :pk AND begins_with(GSI1SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':prefix': `SAVED#REEL#${reelId}`,
        },
        ProjectionExpression: 'PK',
        Limit: 1,
      }),
    );
    return (result.Count ?? 0) > 0;
  },

  getSavedReelIds: async (userId: string, reelIds: string[]): Promise<Set<string>> => {
    if (reelIds.length === 0) return new Set();
    const checks = await Promise.all(
      reelIds.map((reelId) =>
        dynamoClient
          .send(
            new QueryCommand({
              TableName: SAVED_POSTS_TABLE,
              IndexName: 'GSI-PostLookup',
              KeyConditionExpression: 'PK = :pk AND begins_with(GSI1SK, :prefix)',
              ExpressionAttributeValues: {
                ':pk': `USER#${userId}`,
                ':prefix': `SAVED#REEL#${reelId}`,
              },
              ProjectionExpression: 'reelId',
              Limit: 1,
            }),
          )
          .then((r) => ((r.Count ?? 0) > 0 ? reelId : null)),
      ),
    );
    return new Set(checks.filter(Boolean) as string[]);
  },

  // ─── Reports ────────────────────────────────────────────────────────────────

  createReport: async (report: {
    reportId: string;
    entityType: 'REEL' | 'POST' | 'GROUP';
    entityId: string;
    reporterId: string;
    reason: string;
    details?: string;
    createdAt: string;
  }): Promise<void> => {
    await dynamoClient.send(
      new PutCommand({
        TableName: REPORTS_TABLE,
        Item: {
          PK: `${report.entityType}#${report.entityId}`,
          SK: `REPORT#${report.createdAt}#${report.reporterId}`,
          ...report,
        },
      }),
    );
  },

  updateReel: async (reelId: string, updates: Partial<IReel>): Promise<void> => {
    const entries = Object.entries(updates).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return;
    const updateExpr = entries.map(([,], i) => `#k${i} = :v${i}`).join(', ');
    await dynamoClient.send(
      new UpdateCommand({
        TableName: REELS_TABLE,
        Key: { PK: `REEL#${reelId}`, SK: 'META' },
        UpdateExpression: `SET ${updateExpr}`,
        ExpressionAttributeNames: Object.fromEntries(entries.map(([k], i) => [`#k${i}`, k])),
        ExpressionAttributeValues: Object.fromEntries(entries.map(([, v], i) => [`:v${i}`, v])),
      }),
    );
  },

  // ─── Comment Reactions ────────────────────────────────────────────────────────────────

  getCommentReaction: async (
    commentId: string,
    userId: string,
  ): Promise<{ type: ReactionType } | null> => {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: REACTIONS_TABLE,
        Key: { PK: `CMT#${commentId}`, SK: `REACT#${userId}` },
      }),
    );
    const item = result.Item as { type?: string } | undefined;
    if (!item?.type) return null;
    return { type: item.type as ReactionType };
  },

  upsertCommentReaction: async (
    commentId: string,
    userId: string,
    type: ReactionType,
  ): Promise<void> => {
    await dynamoClient.send(
      new PutCommand({
        TableName: REACTIONS_TABLE,
        Item: {
          PK: `CMT#${commentId}`,
          SK: `REACT#${userId}`,
          commentId,
          userId,
          type,
          createdAt: new Date().toISOString(),
        },
      }),
    );
  },

  deleteCommentReaction: async (commentId: string, userId: string): Promise<void> => {
    await dynamoClient.send(
      new DeleteCommand({
        TableName: REACTIONS_TABLE,
        Key: { PK: `CMT#${commentId}`, SK: `REACT#${userId}` },
      }),
    );
  },

  updateComment: async (
    postId: string,
    commentId: string,
    createdAt: string,
    updates: Partial<IComment>,
  ): Promise<void> => {
    const entries = Object.entries(updates).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return;
    const updateExpr = entries.map(([,], i) => `#k${i} = :v${i}`).join(', ');
    await dynamoClient.send(
      new UpdateCommand({
        TableName: COMMENTS_TABLE,
        Key: { PK: `POST#${postId}`, SK: `CMT#${createdAt}#${commentId}` },
        UpdateExpression: `SET ${updateExpr}, updatedAt = :now`,
        ExpressionAttributeNames: Object.fromEntries(entries.map(([k], i) => [`#k${i}`, k])),
        ExpressionAttributeValues: {
          ...Object.fromEntries(entries.map(([, v], i) => [`:v${i}`, v])),
          ':now': new Date().toISOString(),
        },
      }),
    );
  },

  getCommentById: async (postId: string, commentId: string): Promise<IComment | null> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: COMMENTS_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `POST#${postId}`,
          ':prefix': 'CMT#',
        },
      }),
    );
    const items = result.Items as IComment[] | undefined;
    return items?.find((c) => c.commentId === commentId) ?? null;
  },

  // ─── Reel Reactions ───────────────────────────────────────────────────────────────────

  getReelReaction: async (
    reelId: string,
    userId: string,
  ): Promise<{ type: ReactionType } | null> => {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: REACTIONS_TABLE,
        Key: { PK: `REEL#${reelId}`, SK: `REACT#${userId}` },
      }),
    );
    const item = result.Item as { type?: string } | undefined;
    if (!item?.type) return null;
    return { type: item.type as ReactionType };
  },

  batchGetReelReactions: async (
    reelIds: string[],
    userId: string,
  ): Promise<Map<string, ReactionType>> => {
    if (reelIds.length === 0) return new Map();
    const result = await dynamoClient.send(
      new BatchGetCommand({
        RequestItems: {
          [REACTIONS_TABLE]: {
            Keys: reelIds.map((id) => ({ PK: `REEL#${id}`, SK: `REACT#${userId}` })),
          },
        },
      }),
    );
    const map = new Map<string, ReactionType>();
    const items = (result.Responses?.[REACTIONS_TABLE] ?? []) as {
      reelId?: string;
      type?: string;
    }[];
    for (const item of items) {
      if (item.reelId && item.type) {
        map.set(item.reelId, item.type as ReactionType);
      }
    }
    return map;
  },

  upsertReelReaction: async (reelId: string, userId: string, type: ReactionType): Promise<void> => {
    await dynamoClient.send(
      new PutCommand({
        TableName: REACTIONS_TABLE,
        Item: {
          PK: `REEL#${reelId}`,
          SK: `REACT#${userId}`,
          reelId,
          userId,
          type,
          createdAt: new Date().toISOString(),
        },
      }),
    );
  },

  deleteReelReaction: async (reelId: string, userId: string): Promise<void> => {
    await dynamoClient.send(
      new DeleteCommand({
        TableName: REACTIONS_TABLE,
        Key: { PK: `REEL#${reelId}`, SK: `REACT#${userId}` },
      }),
    );
  },

  // ─── Share ────────────────────────────────────────────────────────────────────

  incrementSharesCount: async (postId: string): Promise<void> => {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: POSTS_TABLE,
        Key: { PK: `POST#${postId}`, SK: 'META' },
        UpdateExpression: 'SET sharesCount = if_not_exists(sharesCount, :zero) + :inc',
        ExpressionAttributeValues: { ':inc': 1, ':zero': 0 },
      }),
    );
  },

  // ─── Save ─────────────────────────────────────────────────────────────────────

  savePost: async (userId: string, postId: string): Promise<void> => {
    const savedAt = new Date().toISOString();
    await dynamoClient.send(
      new PutCommand({
        TableName: SAVED_POSTS_TABLE,
        Item: {
          PK: `USER#${userId}`,
          SK: `SAVED#${savedAt}#${postId}`,
          // GSI-PostLookup key — cho phép query/check/unsave theo postId
          GSI1SK: `SAVED#${postId}`,
          userId,
          postId,
          savedAt,
        },
      }),
    );
  },

  unsavePost: async (userId: string, postId: string): Promise<void> => {
    // Query to find the SK (which contains savedAt timestamp)
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: SAVED_POSTS_TABLE,
        IndexName: 'GSI-PostLookup',
        KeyConditionExpression: 'PK = :pk AND begins_with(GSI1SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':prefix': `SAVED#${postId}`,
        },
        ProjectionExpression: 'PK, SK',
        Limit: 1,
      }),
    );
    const item = result.Items?.[0] as { PK: string; SK: string } | undefined;
    if (!item) return;
    await dynamoClient.send(
      new DeleteCommand({
        TableName: SAVED_POSTS_TABLE,
        Key: { PK: item.PK, SK: item.SK },
      }),
    );
  },

  getSavedPost: async (userId: string, postId: string): Promise<boolean> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: SAVED_POSTS_TABLE,
        IndexName: 'GSI-PostLookup',
        KeyConditionExpression: 'PK = :pk AND begins_with(GSI1SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':prefix': `SAVED#${postId}`,
        },
        ProjectionExpression: 'PK',
        Limit: 1,
      }),
    );
    return (result.Count ?? 0) > 0;
  },

  getSavedPostIds: async (userId: string, postIds: string[]): Promise<Set<string>> => {
    if (postIds.length === 0) return new Set();
    // Run parallel point lookups via GSI-PostLookup
    const checks = await Promise.all(
      postIds.map((postId) =>
        dynamoClient
          .send(
            new QueryCommand({
              TableName: SAVED_POSTS_TABLE,
              IndexName: 'GSI-PostLookup',
              KeyConditionExpression: 'PK = :pk AND begins_with(GSI1SK, :prefix)',
              ExpressionAttributeValues: {
                ':pk': `USER#${userId}`,
                ':prefix': `SAVED#${postId}`,
              },
              ProjectionExpression: 'postId',
              Limit: 1,
            }),
          )
          .then((r) => ((r.Count ?? 0) > 0 ? postId : null)),
      ),
    );
    return new Set(checks.filter(Boolean) as string[]);
  },

  getSavedPosts: async (
    userId: string,
    limit: number = 10,
    cursor?: string | null,
  ): Promise<{
    items: Array<{ userId: string; postId: string; savedAt: string }>;
    lastEvaluatedKey?: Record<string, unknown>;
  }> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: SAVED_POSTS_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `USER#${userId}` },
        ScanIndexForward: false,
        Limit: limit + 1,
        ExclusiveStartKey: cursor
          ? JSON.parse(Buffer.from(cursor, 'base64url').toString())
          : undefined,
      }),
    );
    const items = (result.Items ?? []) as Array<{
      userId: string;
      postId: string;
      savedAt: string;
    }>;
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const lastEvaluatedKey =
      hasMore && page.length > 0
        ? {
            PK: `USER#${userId}`,
            SK: `SAVED#${page[page.length - 1].savedAt}#${page[page.length - 1].postId}`,
          }
        : (result.LastEvaluatedKey as Record<string, unknown> | undefined);
    return { items: page, lastEvaluatedKey };
  },
};
