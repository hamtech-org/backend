import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import { env } from '@/config/env.js';

const MESSAGE_USER_HIDE_TABLE = `${env.DYNAMODB_TABLE_PREFIX}MessageUserHide`;

export const messageUserHideRepository = {
  putHide: async (userId: string, conversationId: string, messageId: string): Promise<void> => {
    const now = new Date().toISOString();
    await dynamoClient.send(
      new PutCommand({
        TableName: MESSAGE_USER_HIDE_TABLE,
        Item: {
          PK: `USER#${userId}`,
          SK: `HIDE#${conversationId}#${messageId}`,
          userId,
          conversationId,
          messageId,
          createdAt: now,
        },
      }),
    );
  },

  /** Tin nhắn user đã ẩn trong một hội thoại (SK prefix theo conversation). */
  queryHiddenMessageIdsForConversation: async (
    userId: string,
    conversationId: string,
  ): Promise<Set<string>> => {
    const ids = new Set<string>();
    let exclusiveStartKey: Record<string, unknown> | undefined;
    const pk = `USER#${userId}`;
    const prefix = `HIDE#${conversationId}#`;
    do {
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: MESSAGE_USER_HIDE_TABLE,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: { ':pk': pk, ':prefix': prefix },
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      for (const item of result.Items ?? []) {
        const mid = item.messageId as string | undefined;
        if (mid) ids.add(mid);
      }
      exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (exclusiveStartKey);
    return ids;
  },

  /** Toàn bộ ẩn-theo-user, nhóm theo conversationId (cho danh sách hội thoại). */
  queryAllHiddenGroupedByConversation: async (
    userId: string,
  ): Promise<Map<string, Set<string>>> => {
    const map = new Map<string, Set<string>>();
    let exclusiveStartKey: Record<string, unknown> | undefined;
    const pk = `USER#${userId}`;
    do {
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: MESSAGE_USER_HIDE_TABLE,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: { ':pk': pk, ':prefix': 'HIDE#' },
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      for (const item of result.Items ?? []) {
        const cid = item.conversationId as string | undefined;
        const mid = item.messageId as string | undefined;
        if (!cid || !mid) continue;
        if (!map.has(cid)) map.set(cid, new Set());
        map.get(cid)!.add(mid);
      }
      exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (exclusiveStartKey);
    return map;
  },
};
