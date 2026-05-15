import { PutCommand, QueryCommand, DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import { env } from '@/config/env.js';

const CONVERSATIONS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Conversations`;
type IGroupRequestRecord = {
  PK: string;
  SK: string;
  conversationId: string;
  userId: string;
  status: 'pending' | 'invited';
  requestedAt: string;
  /** User mời vào nhóm (addMembers); không có khi user tự xin vào. */
  invitedBy?: string;
};

export const memberRequestRepository = {
  createGroupRequest: async (
    conversationId: string,
    userId: string,
    status: 'pending' | 'invited' = 'pending',
    invitedBy?: string,
  ): Promise<void> => {
    const inviter = String(invitedBy ?? '').trim();
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
          ...(inviter ? { invitedBy: inviter } : {}),
        },
      }),
    );
  },

  getGroupRequest: async (
    conversationId: string,
    userId: string,
  ): Promise<IGroupRequestRecord | null> => {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: `REQUEST#${userId}` },
      }),
    );
    return (result.Item as IGroupRequestRecord) ?? null;
  },

  getGroupRequests: async (conversationId: string): Promise<IGroupRequestRecord[]> => {
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
    return (result.Items as IGroupRequestRecord[]) ?? [];
  },

  removeGroupRequest: async (conversationId: string, userId: string): Promise<void> => {
    await dynamoClient.send(
      new DeleteCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: `REQUEST#${userId}` },
      }),
    );
  },

  recordKickedMember: async (conversationId: string, userId: string): Promise<void> => {
    await dynamoClient.send(
      new PutCommand({
        TableName: CONVERSATIONS_TABLE,
        Item: {
          PK: `CONV#${conversationId}`,
          SK: `KICKED#${userId}`,
          conversationId,
          userId,
          kickedAt: new Date().toISOString(),
        },
      }),
    );
  },

  isKickedMember: async (conversationId: string, userId: string): Promise<boolean> => {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: `KICKED#${userId}` },
      }),
    );
    return !!result.Item;
  },

  clearKickedMember: async (conversationId: string, userId: string): Promise<void> => {
    await dynamoClient.send(
      new DeleteCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: `KICKED#${userId}` },
      }),
    );
  },
};
