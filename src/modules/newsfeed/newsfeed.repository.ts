import { GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import type { IPost, IComment, IReel } from './newsfeed.types.js';

const POSTS_TABLE = 'Zalogram_Posts';
const COMMENTS_TABLE = 'Zalogram_Comments';
const REELS_TABLE = 'Zalogram_Reels';

export const newsfeedRepository = {
  getPostById: async (postId: string): Promise<IPost | null> => {
    const result = await dynamoClient.send(new GetCommand({
      TableName: POSTS_TABLE,
      Key: { PK: `POST#${postId}`, SK: 'META' },
    }));
    return (result.Item as IPost) ?? null;
  },

  createPost: async (post: IPost): Promise<void> => {
    await dynamoClient.send(new PutCommand({
      TableName: POSTS_TABLE,
      Item: { PK: `POST#${post.postId}`, SK: 'META', ...post },
    }));
  },

  updatePost: async (postId: string, updates: Partial<IPost>): Promise<void> => {
    const entries = Object.entries(updates).filter(([, v]) => v !== undefined);
    const updateExpr = entries.map(([, ], i) => `#k${i} = :v${i}`).join(', ');

    await dynamoClient.send(new UpdateCommand({
      TableName: POSTS_TABLE,
      Key: { PK: `POST#${postId}`, SK: 'META' },
      UpdateExpression: `SET ${updateExpr}, updatedAt = :now`,
      ExpressionAttributeNames: Object.fromEntries(entries.map(([k], i) => [`#k${i}`, k])),
      ExpressionAttributeValues: {
        ...Object.fromEntries(entries.map(([, v], i) => [`:v${i}`, v])),
        ':now': new Date().toISOString(),
      },
    }));
  },

  deletePost: async (postId: string): Promise<void> => {
    await dynamoClient.send(new DeleteCommand({
      TableName: POSTS_TABLE,
      Key: { PK: `POST#${postId}`, SK: 'META' },
    }));
  },

  getCommentsByPostId: async (postId: string, limit: number = 20): Promise<IComment[]> => {
    const result = await dynamoClient.send(new QueryCommand({
      TableName: COMMENTS_TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `POST#${postId}` },
      Limit: limit,
      ScanIndexForward: false,
    }));
    return (result.Items as IComment[]) ?? [];
  },

  createComment: async (postId: string, comment: IComment): Promise<void> => {
    await dynamoClient.send(new PutCommand({
      TableName: COMMENTS_TABLE,
      Item: {
        PK: `POST#${postId}`,
        SK: `CMT#${comment.createdAt}#${comment.commentId}`,
        ...comment,
      },
    }));
  },

  getReelById: async (reelId: string): Promise<IReel | null> => {
    const result = await dynamoClient.send(new GetCommand({
      TableName: REELS_TABLE,
      Key: { PK: `REEL#${reelId}`, SK: 'META' },
    }));
    return (result.Item as IReel) ?? null;
  },

  createReel: async (reel: IReel): Promise<void> => {
    await dynamoClient.send(new PutCommand({
      TableName: REELS_TABLE,
      Item: { PK: `REEL#${reel.reelId}`, SK: 'META', ...reel },
    }));
  },
};
