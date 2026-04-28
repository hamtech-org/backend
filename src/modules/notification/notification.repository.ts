import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import { env } from '@/config/env.js';
import type { INotification } from './notification.types.js';

const TABLE_NAME = `${env.DYNAMODB_TABLE_PREFIX}Notifications`;

export const notificationRepository = {
  getByUserId: async (userId: string, limit: number = 50): Promise<INotification[]> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `USER#${userId}` },
        Limit: limit,
        ScanIndexForward: false,
      }),
    );
    return (result.Items as INotification[]) ?? [];
  },

  create: async (notification: INotification): Promise<void> => {
    await dynamoClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${notification.userId}`,
          SK: `NOTIF#${notification.createdAt}#${notification.notificationId}`,
          ...notification,
        },
      }),
    );
  },

  markAsRead: async (userId: string, notificationId: string, sortKey: string): Promise<void> => {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `USER#${userId}`, SK: sortKey },
        UpdateExpression: 'SET isRead = :read',
        ExpressionAttributeValues: { ':read': true },
      }),
    );
    void notificationId;
  },
};
