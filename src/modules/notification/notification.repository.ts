import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import { env } from '@/config/env.js';
import type { INotification } from './notification.types.js';

const TABLE_NAME = `${env.DYNAMODB_TABLE_PREFIX}Notifications`;

const TTL_DAYS = 90;

function buildSortKey(createdAt: string, notificationId: string): string {
  return `NOTIF#${createdAt}#${notificationId}`;
}

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
    return ((result.Items as INotification[]) ?? []).map((item) => ({
      ...item,
      sortKey: item.sortKey ?? buildSortKey(item.createdAt, item.notificationId),
    }));
  },

  getUnreadCount: async (userId: string): Promise<number> => {
    const items = await notificationRepository.getByUserId(userId, 200);
    return items.filter((n) => !n.isRead).length;
  },

  create: async (notification: INotification): Promise<INotification> => {
    const sortKey = buildSortKey(notification.createdAt, notification.notificationId);
    const expiresAt =
      notification.expiresAt ?? new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const item: INotification = {
      ...notification,
      expiresAt,
      sortKey,
    };

    await dynamoClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${notification.userId}`,
          SK: sortKey,
          ...item,
        },
      }),
    );
    return item;
  },

  markAsRead: async (userId: string, notificationId: string): Promise<boolean> => {
    const items = await notificationRepository.getByUserId(userId, 200);
    const target = items.find((n) => n.notificationId === notificationId);
    if (!target?.sortKey || target.isRead) return false;

    await dynamoClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `USER#${userId}`, SK: target.sortKey },
        UpdateExpression: 'SET isRead = :read',
        ExpressionAttributeValues: { ':read': true },
      }),
    );
    return true;
  },

  markAllAsRead: async (userId: string): Promise<number> => {
    const items = await notificationRepository.getByUserId(userId, 200);
    const unread = items.filter((n) => !n.isRead && n.sortKey);
    await Promise.all(
      unread.map((n) =>
        dynamoClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: `USER#${userId}`, SK: n.sortKey! },
            UpdateExpression: 'SET isRead = :read',
            ExpressionAttributeValues: { ':read': true },
          }),
        ),
      ),
    );
    return unread.length;
  },
};
