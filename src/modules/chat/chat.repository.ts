import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import type { IConversation, IMessage } from './chat.types.js';

const CONVERSATIONS_TABLE = 'Zalogram_Conversations';
const MESSAGES_TABLE = 'Zalogram_Messages';

export const chatRepository = {
  getConversationById: async (conversationId: string): Promise<IConversation | null> => {
    const result = await dynamoClient.send(new GetCommand({
      TableName: CONVERSATIONS_TABLE,
      Key: { PK: `CONV#${conversationId}`, SK: 'META' },
    }));
    return (result.Items as unknown as IConversation) ?? null;
  },

  getMessages: async (conversationId: string, limit: number = 20): Promise<IMessage[]> => {
    const result = await dynamoClient.send(new QueryCommand({
      TableName: MESSAGES_TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `CONV#${conversationId}` },
      Limit: limit,
      ScanIndexForward: false,
    }));
    return (result.Items as IMessage[]) ?? [];
  },

  createMessage: async (message: IMessage): Promise<void> => {
    await dynamoClient.send(new PutCommand({
      TableName: MESSAGES_TABLE,
      Item: {
        PK: `CONV#${message.conversationId}`,
        SK: `MSG#${message.createdAt}#${message.messageId}`,
        ...message,
      },
    }));
  },

  updateMessage: async (conversationId: string, messageId: string, sortKey: string, updates: Partial<IMessage>): Promise<void> => {
    const entries = Object.entries(updates).filter(([, v]) => v !== undefined);
    const updateExpr = entries.map(([, ], i) => `#k${i} = :v${i}`).join(', ');

    await dynamoClient.send(new UpdateCommand({
      TableName: MESSAGES_TABLE,
      Key: { PK: `CONV#${conversationId}`, SK: sortKey },
      UpdateExpression: `SET ${updateExpr}, updatedAt = :now`,
      ExpressionAttributeNames: Object.fromEntries(entries.map(([k], i) => [`#k${i}`, k])),
      ExpressionAttributeValues: {
        ...Object.fromEntries(entries.map(([, v], i) => [`:v${i}`, v])),
        ':now': new Date().toISOString(),
      },
    }));
    void messageId;
  },
};
