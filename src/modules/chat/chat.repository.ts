import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import type { IConversation, IConversationMember, IMessage } from './chat.types.js';
import type { MessageStatus } from '@/shared/types/chat.types.js';

const CONVERSATIONS_TABLE = 'Zalogram_Conversations';
const MESSAGES_TABLE = 'Zalogram_Messages';
const MESSAGE_STATUS_TABLE = 'Zalogram_MessageStatus';

export const chatRepository = {
  // ─── Conversations ───────────────────────────────────────────────────

  getConversationById: async (conversationId: string): Promise<IConversation | null> => {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: 'META' },
      }),
    );
    return (result.Item as IConversation) ?? null;
  },

  /**
   * Lấy danh sách hội thoại của user qua GSI-2 (userId PK)
   * GSI-2: userId (PK) — Tìm tất cả hội thoại của user
   */
  getConversations: async (userId: string): Promise<IConversation[]> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: CONVERSATIONS_TABLE,
        IndexName: 'GSI-2',
        KeyConditionExpression: 'userId = :uid',
        FilterExpression: 'begins_with(SK, :memberPrefix)',
        ExpressionAttributeValues: {
          ':uid': userId,
          ':memberPrefix': 'MEMBER#',
        },
      }),
    );

    if (!result.Items || result.Items.length === 0) return [];

    // Lấy conversationId từ PK của các member records
    const convIds = result.Items.map((item) => {
      const pk = item['PK'] as string;
      return pk.replace('CONV#', '');
    });

    // Fetch META cho từng conversation
    const conversations = await Promise.all(
      convIds.map((id) => chatRepository.getConversationById(id)),
    );

    return conversations.filter((c): c is IConversation => c !== null);
  },

  createConversation: async (conversation: IConversation): Promise<void> => {
    await dynamoClient.send(
      new PutCommand({
        TableName: CONVERSATIONS_TABLE,
        Item: {
          PK: `CONV#${conversation.conversationId}`,
          SK: 'META',
          ...conversation,
        },
      }),
    );
  },

  /**
   * Thêm thành viên vào conversation
   * PK: CONV#{conversationId}, SK: MEMBER#{userId}
   * userId được lưu thêm cho GSI-2
   */
  addConversationMember: async (member: IConversationMember): Promise<void> => {
    await dynamoClient.send(
      new PutCommand({
        TableName: CONVERSATIONS_TABLE,
        Item: {
          PK: `CONV#${member.conversationId}`,
          SK: `MEMBER#${member.userId}`,
          ...member,
        },
      }),
    );
  },

  getConversationMembers: async (conversationId: string): Promise<IConversationMember[]> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: CONVERSATIONS_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :memberPrefix)',
        ExpressionAttributeValues: {
          ':pk': `CONV#${conversationId}`,
          ':memberPrefix': 'MEMBER#',
        },
      }),
    );
    return (result.Items as IConversationMember[]) ?? [];
  },

  updateConversationLastMessage: async (
    conversationId: string,
    lastMessage: IConversation['lastMessage'],
    lastMessageAt: string,
  ): Promise<void> => {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: 'META' },
        UpdateExpression: 'SET lastMessage = :lm, lastMessageAt = :lma, updatedAt = :now',
        ExpressionAttributeValues: {
          ':lm': lastMessage,
          ':lma': lastMessageAt,
          ':now': new Date().toISOString(),
        },
      }),
    );
  },

  clearConversationLastMessage: async (conversationId: string): Promise<void> => {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: 'META' },
        UpdateExpression: 'REMOVE lastMessage, lastMessageAt SET updatedAt = :now',
        ExpressionAttributeValues: {
          ':now': new Date().toISOString(),
        },
      }),
    );
  },

  /**
   * Tìm conversation 1-1 đã tồn tại giữa 2 user
   * Lấy danh sách conv của userA rồi kiểm tra xem userB có trong đó không
   */
  findDirectConversation: async (
    userAId: string,
    userBId: string,
  ): Promise<IConversation | null> => {
    const convs = await chatRepository.getConversations(userAId);
    for (const conv of convs) {
      if (conv.type !== 'direct') continue;
      const members = await chatRepository.getConversationMembers(conv.conversationId);
      const memberIds = members.map((m) => m.userId);
      if (memberIds.includes(userBId)) return conv;
    }
    return null;
  },

  deleteConversation: async (conversationId: string): Promise<void> => {
    await dynamoClient.send(
      new DeleteCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: 'META' },
      }),
    );
  },

  // ─── Messages ────────────────────────────────────────────────────────

  getMessages: async (conversationId: string, limit: number = 20): Promise<IMessage[]> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: MESSAGES_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `CONV#${conversationId}` },
        Limit: limit,
        ScanIndexForward: false,
      }),
    );
    return (result.Items as IMessage[]) ?? [];
  },

  getMessageById: async (
    conversationId: string,
    messageId: string,
    createdAt: string,
  ): Promise<IMessage | null> => {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: MESSAGES_TABLE,
        Key: {
          PK: `CONV#${conversationId}`,
          SK: `MSG#${createdAt}#${messageId}`,
        },
      }),
    );
    return (result.Item as IMessage) ?? null;
  },

  createMessage: async (message: IMessage): Promise<void> => {
    await dynamoClient.send(
      new PutCommand({
        TableName: MESSAGES_TABLE,
        Item: {
          PK: `CONV#${message.conversationId}`,
          SK: `MSG#${message.createdAt}#${message.messageId}`,
          ...message,
        },
      }),
    );
  },

  updateMessage: async (
    conversationId: string,
    messageId: string,
    sortKey: string,
    updates: Partial<IMessage>,
  ): Promise<void> => {
    const entries = Object.entries(updates).filter(([, v]) => v !== undefined);
    const updateExpr = entries.map(([,], i) => `#k${i} = :v${i}`).join(', ');

    await dynamoClient.send(
      new UpdateCommand({
        TableName: MESSAGES_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: sortKey },
        UpdateExpression: `SET ${updateExpr}, updatedAt = :now`,
        ExpressionAttributeNames: Object.fromEntries(entries.map(([k], i) => [`#k${i}`, k])),
        ExpressionAttributeValues: {
          ...Object.fromEntries(entries.map(([, v], i) => [`:v${i}`, v])),
          ':now': new Date().toISOString(),
        },
      }),
    );
    void messageId;
  },

  // ─── Message Status ───────────────────────────────────────────────────

  updateMessageStatus: async (
    messageId: string,
    userId: string,
    status: MessageStatus,
  ): Promise<void> => {
    const now = new Date().toISOString();
    await dynamoClient.send(
      new PutCommand({
        TableName: MESSAGE_STATUS_TABLE,
        Item: {
          PK: `MSG#${messageId}`,
          SK: `STATUS#${userId}`,
          messageId,
          userId,
          status,
          ...(status === 'delivered' ? { deliveredAt: now } : {}),
          ...(status === 'read' ? { readAt: now } : {}),
        },
      }),
    );
  },

  /**
   * Cập nhật unreadCount cho member trong conversation
   */
  updateMemberUnreadCount: async (
    conversationId: string,
    userId: string,
    increment: number,
  ): Promise<void> => {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: `MEMBER#${userId}` },
        UpdateExpression: 'ADD unreadCount :inc',
        ExpressionAttributeValues: { ':inc': increment },
      }),
    );
  },

  resetMemberUnreadCount: async (conversationId: string, userId: string): Promise<void> => {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: `MEMBER#${userId}` },
        UpdateExpression: 'SET unreadCount = :zero, lastReadAt = :now',
        ExpressionAttributeValues: {
          ':zero': 0,
          ':now': new Date().toISOString(),
        },
      }),
    );
  },
};
