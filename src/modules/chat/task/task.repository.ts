import { PutCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import { env } from '@/config/env.js';

const CONVERSATIONS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Conversations`;
type TaskRecord = Record<string, unknown> & {
  conversationId: string;
  taskId: string;
  creatorId?: string;
};

export const taskRepository = {
  createTask: async (task: TaskRecord): Promise<void> => {
    await dynamoClient.send(
      new PutCommand({
        TableName: CONVERSATIONS_TABLE,
        Item: {
          PK: `CONV#${task.conversationId}`,
          SK: `TASK#${task.taskId}`,
          ...task,
        },
      }),
    );
  },

  getTasks: async (conversationId: string): Promise<TaskRecord[]> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: CONVERSATIONS_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :taskPrefix)',
        ExpressionAttributeValues: {
          ':pk': `CONV#${conversationId}`,
          ':taskPrefix': 'TASK#',
        },
      }),
    );
    return (result.Items as TaskRecord[]) ?? [];
  },

  /**
   * Quét các task có dueDate và chưa gửi nhắc hạn.
   * Lưu ý: Scan phù hợp cho demo/nhóm nhỏ; production nên có GSI theo dueDate.
   */
  scanDueTasksCandidates: async (): Promise<TaskRecord[]> => {
    const result = await dynamoClient.send(
      new ScanCommand({
        TableName: CONVERSATIONS_TABLE,
        FilterExpression:
          'begins_with(SK, :taskPrefix) AND attribute_exists(dueDate) AND attribute_not_exists(reminderDueSentAt) AND (attribute_not_exists(#st) OR #st <> :done)',
        ExpressionAttributeNames: {
          '#st': 'status',
        },
        ExpressionAttributeValues: {
          ':taskPrefix': 'TASK#',
          ':done': 'done',
        },
      }),
    );
    return (result.Items as TaskRecord[]) ?? [];
  },

  updateTask: async (
    conversationId: string,
    taskId: string,
    updates: Record<string, unknown>,
  ): Promise<void> => {
    const entries = Object.entries(updates);
    const updateExpr =
      'SET ' + entries.map((_, i) => `#k${i} = :v${i}`).join(', ') + ', updatedAt = :now';
    const attrNames = Object.fromEntries(entries.map(([k], i) => [`#k${i}`, k]));
    const attrValues = {
      ...Object.fromEntries(entries.map(([, v], i) => [`:v${i}`, v])),
      ':now': new Date().toISOString(),
    };

    await dynamoClient.send(
      new UpdateCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: `TASK#${taskId}` },
        UpdateExpression: updateExpr,
        ExpressionAttributeNames: attrNames,
        ExpressionAttributeValues: attrValues,
      }),
    );
  },

  /**
   * Set `reminderDueSentAt` exactly once (idempotent).
   * Returns `true` if set now, `false` if it was already set by another caller.
   */
  setDueReminderOnce: async (
    conversationId: string,
    taskId: string,
    reminderDueSentAt: string,
  ): Promise<boolean> => {
    try {
      await dynamoClient.send(
        new UpdateCommand({
          TableName: CONVERSATIONS_TABLE,
          Key: { PK: `CONV#${conversationId}`, SK: `TASK#${taskId}` },
          UpdateExpression: 'SET reminderDueSentAt = :v, updatedAt = :now',
          ConditionExpression: 'attribute_not_exists(reminderDueSentAt)',
          ExpressionAttributeValues: {
            ':v': reminderDueSentAt,
            ':now': new Date().toISOString(),
          },
        }),
      );
      return true;
    } catch (err: any) {
      if (String(err?.name ?? '') === 'ConditionalCheckFailedException') return false;
      throw err;
    }
  },

  deleteTask: async (conversationId: string, taskId: string): Promise<void> => {
    await dynamoClient.send(
      new DeleteCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: `TASK#${taskId}` },
      }),
    );
  },
};
