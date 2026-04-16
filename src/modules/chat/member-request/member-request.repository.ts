import { PutCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';

const CONVERSATIONS_TABLE = 'Zalogram_Conversations';

export const memberRequestRepository = {
  createGroupRequest: async (
    conversationId: string,
    userId: string,
    status: 'pending' | 'invited' = 'pending',
  ): Promise<void> => {
    await dynamoClient.send(
      new PutCommand({
        TableName: CONVERSATIONS_TABLE,
        Item: {
          PK: `CONV#${conversationId}`,
          SK: `REQUEST#${userId}`,
          conversationId,
          userId,
          status,
          requestedAt: new Date().toISOString(),
        },
      }),
    );
  },

  getGroupRequests: async (conversationId: string): Promise<any[]> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: CONVERSATIONS_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :reqPrefix)',
        ExpressionAttributeValues: {
          ':pk': `CONV#${conversationId}`,
          ':reqPrefix': 'REQUEST#',
        },
      }),
    );
    return result.Items ?? [];
  },

  removeGroupRequest: async (conversationId: string, userId: string): Promise<void> => {
    await dynamoClient.send(
      new DeleteCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: `REQUEST#${userId}` },
      }),
    );
  },
};
