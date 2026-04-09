import { GetCommand, PutCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import type { ISession } from './auth.types.js';

const USERS_TABLE = 'Zalogram_Users';
const SESSIONS_TABLE = 'Zalogram_Sessions';

export const authRepository = {
  findUserByEmail: async (email: string): Promise<Record<string, unknown> | null> => {
    const result = await dynamoClient.send(new QueryCommand({
      TableName: USERS_TABLE,
      IndexName: 'GSI-1',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': email },
      Limit: 1,
    }));
    return (result.Items?.[0] as Record<string, unknown>) ?? null;
  },

  createSession: async (session: ISession): Promise<void> => {
    await dynamoClient.send(new PutCommand({
      TableName: SESSIONS_TABLE,
      Item: {
        PK: `SESSION#${session.sessionId}`,
        SK: `USER#${session.userId}`,
        ...session,
      },
    }));
  },

  deleteSession: async (sessionId: string, userId: string): Promise<void> => {
    await dynamoClient.send(new DeleteCommand({
      TableName: SESSIONS_TABLE,
      Key: { PK: `SESSION#${sessionId}`, SK: `USER#${userId}` },
    }));
  },
};
