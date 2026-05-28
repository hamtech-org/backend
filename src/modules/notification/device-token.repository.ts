import { DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { createHash } from 'node:crypto';
import { dynamoClient } from '@/config/database.js';
import { env } from '@/config/env.js';
import type { IDevicePushToken, PushPlatform } from './notification.types.js';

const TABLE_NAME = `${env.DYNAMODB_TABLE_PREFIX}Users`;

function tokenSk(token: string): string {
  const hash = createHash('sha256').update(token).digest('hex').slice(0, 32);
  return `DEVICE_TOKEN#${hash}`;
}

export const deviceTokenRepository = {
  upsert: async (
    userId: string,
    token: string,
    platform: PushPlatform,
  ): Promise<IDevicePushToken> => {
    const now = new Date().toISOString();
    const record: IDevicePushToken = {
      userId,
      token,
      platform,
      createdAt: now,
      updatedAt: now,
    };
    await dynamoClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${userId}`,
          SK: tokenSk(token),
          ...record,
        },
      }),
    );
    return record;
  },

  listByUserId: async (userId: string): Promise<IDevicePushToken[]> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':sk': 'DEVICE_TOKEN#',
        },
      }),
    );
    return (result.Items as IDevicePushToken[]) ?? [];
  },

  remove: async (userId: string, token: string): Promise<void> => {
    await dynamoClient.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { PK: `USER#${userId}`, SK: tokenSk(token) },
      }),
    );
  },
};
