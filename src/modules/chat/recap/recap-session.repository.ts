import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import { env } from '@/config/env.js';
import type { IGroupRecapSession } from './recap-session.types.js';

const CONVERSATIONS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Conversations`;

function currentSessionKey(conversationId: string, userId: string) {
  return {
    PK: `CONV#${conversationId}`,
    SK: `AI_RECAP_CURRENT#${userId}`,
  };
}

export const groupRecapSessionRepository = {
  getCurrentSession: async (
    conversationId: string,
    userId: string,
  ): Promise<IGroupRecapSession | null> => {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: currentSessionKey(conversationId, userId),
      }),
    );
    return (result.Item as IGroupRecapSession | undefined) ?? null;
  },

  putCurrentSession: async (session: IGroupRecapSession): Promise<void> => {
    await dynamoClient.send(
      new PutCommand({
        TableName: CONVERSATIONS_TABLE,
        Item: {
          ...currentSessionKey(session.conversationId, session.userId),
          entityType: 'GROUP_RECAP_SESSION',
          ...session,
        },
      }),
    );
  },
};
