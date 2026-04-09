import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
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
};
