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
import type { IPost, IComment, IReel } from './newsfeed.types.js';

const POSTS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Posts`;
const COMMENTS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Comments`;
const REACTIONS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Reactions`;
const REELS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Reels`;

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
};
