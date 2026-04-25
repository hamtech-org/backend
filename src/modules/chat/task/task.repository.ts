import { PutCommand, QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
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

  deleteTask: async (conversationId: string, taskId: string): Promise<void> => {
    await dynamoClient.send(
      new DeleteCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: `TASK#${taskId}` },
      }),
    );
  },
};
