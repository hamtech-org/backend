import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import { env } from '@/config/env.js';
import { v4 as uuidv4 } from 'uuid';

const TABLE = `${env.DYNAMODB_TABLE_PREFIX}AiAssistant`;

export type AiAssistantMessageRole = 'user' | 'assistant';

export type AiAssistantStoredMessage = {
  messageId: string;
  threadId: string;
  role: AiAssistantMessageRole;
  content: string;
  createdAt: string;
};

export type AiAssistantPendingTool = {
  pendingId: string;
  threadId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  requestedAt: string;
};

function userDefaultKey(userId: string) {
  return { PK: `USER#${userId}`, SK: 'DEFAULT' as const };
}

function threadMsgPk(threadId: string) {
  return `THREADMSG#${threadId}`;
}

function threadStatePk(threadId: string) {
  return `THREADSTATE#${threadId}`;
}

export const aiAssistantRepository = {
  getDefaultThreadId: async (userId: string): Promise<string | null> => {
    const res = await dynamoClient.send(
      new GetCommand({
        TableName: TABLE,
        Key: userDefaultKey(userId),
      }),
    );
    const tid = (res.Item as { threadId?: string } | undefined)?.threadId;
    return typeof tid === 'string' && tid.length > 0 ? tid : null;
  },

  getOrCreateDefaultThreadId: async (userId: string): Promise<string> => {
    const existing = await aiAssistantRepository.getDefaultThreadId(userId);
    if (existing) return existing;

    const threadId = uuidv4();
    const now = new Date().toISOString();
    try {
      await dynamoClient.send(
        new PutCommand({
          TableName: TABLE,
          Item: {
            ...userDefaultKey(userId),
            threadId,
            createdAt: now,
            updatedAt: now,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
      return threadId;
    } catch (err: unknown) {
      const name =
        err && typeof err === 'object' && 'name' in err
          ? String((err as { name?: string }).name)
          : '';
      if (name === 'ConditionalCheckFailedException') {
        const again = await aiAssistantRepository.getDefaultThreadId(userId);
        if (again) return again;
      }
      throw err;
    }
  },

  assertThreadOwnedByUser: async (userId: string, threadId: string): Promise<void> => {
    const tid = await aiAssistantRepository.getDefaultThreadId(userId);
    if (!tid || tid !== threadId) {
      throw new Error('AI thread không hợp lệ hoặc không thuộc tài khoản này');
    }
  },

  appendMessage: async (
    threadId: string,
    role: AiAssistantMessageRole,
    content: string,
  ): Promise<AiAssistantStoredMessage> => {
    const messageId = uuidv4();
    const createdAt = new Date().toISOString();
    const trimmed = content.trim();
    await dynamoClient.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          PK: threadMsgPk(threadId),
          SK: `MSG#${createdAt}#${messageId}`,
          threadId,
          messageId,
          role,
          content: trimmed,
          createdAt,
        },
      }),
    );
    return { messageId, threadId, role, content: trimmed, createdAt };
  },

  listRecentMessages: async (
    threadId: string,
    limit: number,
  ): Promise<AiAssistantStoredMessage[]> => {
    const cap = Math.min(Math.max(1, limit), 80);
    const res = await dynamoClient.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :m)',
        ExpressionAttributeValues: {
          ':pk': threadMsgPk(threadId),
          ':m': 'MSG#',
        },
        ScanIndexForward: false,
        Limit: cap,
      }),
    );
    const rows = (res.Items ?? []) as Array<{
      messageId?: string;
      threadId?: string;
      role?: string;
      content?: string;
      createdAt?: string;
    }>;
    const out: AiAssistantStoredMessage[] = [];
    for (const it of rows) {
      if (!it.messageId || !it.role || !it.content || !it.createdAt) continue;
      if (it.role !== 'user' && it.role !== 'assistant') continue;
      out.push({
        messageId: it.messageId,
        threadId: threadId,
        role: it.role,
        content: it.content,
        createdAt: it.createdAt,
      });
    }
    out.reverse();
    return out;
  },

  getPendingTool: async (threadId: string): Promise<AiAssistantPendingTool | null> => {
    const res = await dynamoClient.send(
      new GetCommand({
        TableName: TABLE,
        Key: { PK: threadStatePk(threadId), SK: 'PENDING_TOOL' },
      }),
    );
    const row = (res.Item ?? null) as {
      pendingId?: string;
      threadId?: string;
      toolName?: string;
      toolArgs?: Record<string, unknown>;
      requestedAt?: string;
    } | null;
    if (!row?.pendingId || !row.threadId || !row.toolName || !row.requestedAt) return null;
    return {
      pendingId: row.pendingId,
      threadId: row.threadId,
      toolName: row.toolName,
      toolArgs: row.toolArgs ?? {},
      requestedAt: row.requestedAt,
    };
  },

  setPendingTool: async (
    threadId: string,
    toolName: string,
    toolArgs: Record<string, unknown>,
  ): Promise<AiAssistantPendingTool> => {
    const pendingId = uuidv4();
    const requestedAt = new Date().toISOString();
    const item: AiAssistantPendingTool = {
      pendingId,
      threadId,
      toolName,
      toolArgs,
      requestedAt,
    };
    await dynamoClient.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          PK: threadStatePk(threadId),
          SK: 'PENDING_TOOL',
          ...item,
        },
      }),
    );
    return item;
  },

  clearPendingTool: async (threadId: string): Promise<void> => {
    await dynamoClient.send(
      new DeleteCommand({
        TableName: TABLE,
        Key: { PK: threadStatePk(threadId), SK: 'PENDING_TOOL' },
      }),
    );
  },

  touchDefaultThread: async (userId: string): Promise<void> => {
    const now = new Date().toISOString();
    await dynamoClient.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: userDefaultKey(userId),
        UpdateExpression: 'SET updatedAt = :t',
        ExpressionAttributeValues: { ':t': now },
      }),
    );
  },
};
