import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import { env } from '@/config/env.js';
import { v4 as uuidv4 } from 'uuid';
import type { AiAssistantClientAction } from '../shared/types/assistant.types.js';

const TABLE = `${env.DYNAMODB_TABLE_PREFIX}AiAssistant`;

export type AiAssistantMessageRole = 'user' | 'assistant';

export type AiAssistantStoredMessage = {
  messageId: string;
  threadId: string;
  role: AiAssistantMessageRole;
  content: string;
  createdAt: string;
  actions?: AiAssistantClientAction[];
};

export type AiAssistantPendingTool = {
  pendingId: string;
  threadId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  assistantReply?: string;
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
    actions?: AiAssistantClientAction[],
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
          ...(actions && actions.length ? { actions } : {}),
        },
      }),
    );
    return {
      messageId,
      threadId,
      role,
      content: trimmed,
      createdAt,
      ...(actions && actions.length ? { actions } : {}),
    };
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
      actions?: AiAssistantClientAction[];
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
        ...(Array.isArray(it.actions) && it.actions.length ? { actions: it.actions } : {}),
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
      assistantReply?: string;
      requestedAt?: string;
    } | null;
    if (!row?.pendingId || !row.threadId || !row.toolName || !row.requestedAt) return null;
    return {
      pendingId: row.pendingId,
      threadId: row.threadId,
      toolName: row.toolName,
      toolArgs: row.toolArgs ?? {},
      ...(typeof row.assistantReply === 'string' && row.assistantReply.trim()
        ? { assistantReply: row.assistantReply.trim() }
        : {}),
      requestedAt: row.requestedAt,
    };
  },

  setPendingTool: async (
    threadId: string,
    toolName: string,
    toolArgs: Record<string, unknown>,
    assistantReply?: string,
  ): Promise<AiAssistantPendingTool> => {
    const pendingId = uuidv4();
    const requestedAt = new Date().toISOString();
    const trimmedAssistantReply = assistantReply?.trim();
    const item: AiAssistantPendingTool = {
      pendingId,
      threadId,
      toolName,
      toolArgs,
      ...(trimmedAssistantReply ? { assistantReply: trimmedAssistantReply } : {}),
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

  claimPendingTool: async (threadId: string, pendingId: string): Promise<boolean> => {
    try {
      await dynamoClient.send(
        new DeleteCommand({
          TableName: TABLE,
          Key: { PK: threadStatePk(threadId), SK: 'PENDING_TOOL' },
          ConditionExpression: 'pendingId = :pendingId',
          ExpressionAttributeValues: { ':pendingId': pendingId },
        }),
      );
      return true;
    } catch (err: unknown) {
      const name =
        err && typeof err === 'object' && 'name' in err
          ? String((err as { name?: string }).name)
          : '';
      if (name === 'ConditionalCheckFailedException') {
        return false;
      }
      throw err;
    }
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

  clearAndResetDefaultThread: async (
    userId: string,
  ): Promise<{ previousThreadId: string | null; threadId: string; deletedMessages: number }> => {
    const previousThreadId = await aiAssistantRepository.getDefaultThreadId(userId);

    // Always create a new thread id so client can safely re-join.
    const threadId = uuidv4();
    const now = new Date().toISOString();

    // 1) Delete old thread messages + state (best-effort; safe if null)
    let deletedMessages = 0;
    if (previousThreadId) {
      // delete pending tool state
      await aiAssistantRepository.clearPendingTool(previousThreadId);

      // delete messages in batches of 25
      let lastKey: Record<string, unknown> | undefined;
      do {
        const res = await dynamoClient.send(
          new QueryCommand({
            TableName: TABLE,
            KeyConditionExpression: 'PK = :pk',
            ExpressionAttributeValues: { ':pk': threadMsgPk(previousThreadId) },
            ExclusiveStartKey: lastKey as any,
          }),
        );
        lastKey = res.LastEvaluatedKey as any;
        const items = (res.Items ?? []) as Array<{ PK?: string; SK?: string }>;
        const keys = items
          .filter((it) => typeof it.PK === 'string' && typeof it.SK === 'string')
          .map((it) => ({ PK: it.PK as string, SK: it.SK as string }));
        deletedMessages += keys.length;

        for (let i = 0; i < keys.length; i += 25) {
          const chunk = keys.slice(i, i + 25);
          await dynamoClient.send(
            new BatchWriteCommand({
              RequestItems: {
                [TABLE]: chunk.map((Key) => ({ DeleteRequest: { Key } })),
              },
            }),
          );
        }
      } while (lastKey);
    }

    // 2) Upsert/overwrite DEFAULT mapping with new threadId
    await dynamoClient.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          ...userDefaultKey(userId),
          threadId,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    return { previousThreadId, threadId, deletedMessages };
  },
};
