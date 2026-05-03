import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import { env } from '@/config/env.js';
import type { IPost, IComment, IReel, ReactionType, IReactionSummary } from './newsfeed.types.js';

const POSTS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Posts`;
const COMMENTS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Comments`;
const REACTIONS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Reactions`;
const REELS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Reels`;

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
    limit: number = 20,
    cursor?: { createdAt: string; commentId: string } | null,
  ): Promise<{ items: IComment[]; lastEvaluatedKey?: Record<string, unknown> }> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: COMMENTS_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `POST#${postId}` },
        Limit: limit,
        ScanIndexForward: false,
        ExclusiveStartKey: cursor
          ? {
              PK: `POST#${postId}`,
              SK: `CMT#${cursor.createdAt}#${cursor.commentId}`,
            }
          : undefined,
      }),
    );
    return {
      items: (result.Items as IComment[]) ?? [],
      lastEvaluatedKey: result.LastEvaluatedKey as Record<string, unknown> | undefined,
    };
  },

  createComment: async (postId: string, comment: IComment): Promise<void> => {
    await dynamoClient.send(
      new PutCommand({
        TableName: COMMENTS_TABLE,
        Item: {
          PK: `POST#${postId}`,
          SK: `CMT#${comment.createdAt}#${comment.commentId}`,
          ...comment,
        },
      }),
    );
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
        Item: { PK: `REEL#${reel.reelId}`, SK: 'META', ...reel },
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
    // Query by PK + begins_with SK to find the comment
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: COMMENTS_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `POST#${postId}`,
          ':prefix': `CMT#`,
        },
        FilterExpression: 'commentId = :cid',
        ExpressionAttributeNames: undefined,
      }),
    );
    // Filter locally since FilterExpression on sort key needs scan
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
};
