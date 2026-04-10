import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import type { IConversation, IConversationMember, IMessage } from './chat.types.js';

const CONVERSATIONS_TABLE = 'Zalogram_Conversations';
const MESSAGES_TABLE = 'Zalogram_Messages';

export const chatRepository = {
  // ─── Conversations ──────────────────────────────────────────────────────────

  getConversationById: async (conversationId: string): Promise<IConversation | null> => {
    const result = await dynamoClient.send(new GetCommand({
      TableName: CONVERSATIONS_TABLE,
      Key: { PK: `CONV#${conversationId}`, SK: 'META' },
    }));
    return (result.Item as IConversation) ?? null;
  },

  createConversation: async (conversation: IConversation): Promise<void> => {
    await dynamoClient.send(new PutCommand({
      TableName: CONVERSATIONS_TABLE,
      Item: {
        PK: `CONV#${conversation.conversationId}`,
        SK: 'META',
        ...conversation,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }));
  },

  updateConversation: async (conversationId: string, updates: Partial<IConversation>): Promise<void> => {
    const entries = Object.entries(updates).filter(([, v]) => v !== undefined);
    await dynamoClient.send(new UpdateCommand({
      TableName: CONVERSATIONS_TABLE,
      Key: { PK: `CONV#${conversationId}`, SK: 'META' },
      UpdateExpression: `SET ${entries.map(([k], i) => `#k${i} = :v${i}`).join(', ')}, updatedAt = :now`,
      ExpressionAttributeNames: Object.fromEntries(entries.map(([k], i) => [`#k${i}`, k])),
      ExpressionAttributeValues: {
        ...Object.fromEntries(entries.map(([, v], i) => [`:v${i}`, v])),
        ':now': new Date().toISOString(),
      },
    }));
  },

  // ─── Members ────────────────────────────────────────────────────────────────

  addMember: async (member: IConversationMember): Promise<void> => {
    await dynamoClient.send(new PutCommand({
      TableName: CONVERSATIONS_TABLE,
      Item: {
        PK: `CONV#${member.conversationId}`,
        SK: `MEMBER#${member.userId}`,
        ...member,
      },
    }));
  },

  getMember: async (conversationId: string, userId: string): Promise<IConversationMember | null> => {
    const result = await dynamoClient.send(new GetCommand({
      TableName: CONVERSATIONS_TABLE,
      Key: { PK: `CONV#${conversationId}`, SK: `MEMBER#${userId}` },
    }));
    return (result.Item as IConversationMember) ?? null;
  },

  getMembers: async (conversationId: string): Promise<IConversationMember[]> => {
    const result = await dynamoClient.send(new QueryCommand({
      TableName: CONVERSATIONS_TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `CONV#${conversationId}`,
        ':prefix': 'MEMBER#',
      },
    }));
    return (result.Items as IConversationMember[]) ?? [];
  },

  removeMember: async (conversationId: string, userId: string): Promise<void> => {
    await dynamoClient.send(new DeleteCommand({
      TableName: CONVERSATIONS_TABLE,
      Key: { PK: `CONV#${conversationId}`, SK: `MEMBER#${userId}` },
    }));
  },

  updateMemberRole: async (conversationId: string, userId: string, role: string): Promise<void> => {
    await dynamoClient.send(new UpdateCommand({
      TableName: CONVERSATIONS_TABLE,
      Key: { PK: `CONV#${conversationId}`, SK: `MEMBER#${userId}` },
      UpdateExpression: 'SET #role = :role',
      ExpressionAttributeNames: { '#role': 'role' },
      ExpressionAttributeValues: { ':role': role },
    }));
  },

  // ─── Messages ───────────────────────────────────────────────────────────────

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
    const updateExpr = entries.map(([ ], i) => `#k${i} = :v${i}`).join(', ');

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
