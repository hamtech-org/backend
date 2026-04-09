import { GetCommand, UpdateCommand, QueryCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import type { IUser, IUpdateProfileDto } from './user.types.js';

const TABLE_NAME = 'Zalogram_Users';

export const userRepository = {
  findById: async (userId: string): Promise<IUser | null> => {
    const result = await dynamoClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
    }));
    return (result.Item as IUser) ?? null;
  },

  update: async (userId: string, data: IUpdateProfileDto): Promise<IUser> => {
    const entries = Object.entries(data).filter(([, v]) => v !== undefined);
    const updateExpr = entries.map(([, ], i) => `#k${i} = :v${i}`).join(', ');

    const result = await dynamoClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
      UpdateExpression: `SET ${updateExpr}, updatedAt = :now`,
      ExpressionAttributeNames: Object.fromEntries(entries.map(([k], i) => [`#k${i}`, k])),
      ExpressionAttributeValues: {
        ...Object.fromEntries(entries.map(([, v], i) => [`:v${i}`, v])),
        ':now': new Date().toISOString(),
      },
      ReturnValues: 'ALL_NEW',
    }));
    return result.Attributes as IUser;
  },

  search: async (query: string, limit: number = 10, offset: number = 0): Promise<IUser[]> => {
    // Search by displayName or email (case-insensitive) using GSI
    const result = await dynamoClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI-1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': 'SEARCH',
        ':sk': query.toLowerCase(),
      },
      Limit: limit,
      ExclusiveStartKey: offset > 0 ? { offset } : undefined,
      ScanIndexForward: true,
    }));
    return (result.Items as IUser[]) || [];
  },

  findMultipleById: async (userIds: string[]): Promise<IUser[]> => {
    if (userIds.length === 0) return [];

    const keys = userIds.map((userId) => ({
      PK: `USER#${userId}`,
      SK: 'PROFILE',
    }));

    const result = await dynamoClient.send(new BatchGetCommand({
      RequestItems: {
        [TABLE_NAME]: {
          Keys: keys,
        },
      },
    }));

    return (result.Responses?.[TABLE_NAME] as IUser[]) || [];
  },
};
