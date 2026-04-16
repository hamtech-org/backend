import { PutCommand, QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';

const CONVERSATIONS_TABLE = 'Zalogram_Conversations';

export const pollRepository = {
  createPoll: async (poll: any): Promise<void> => {
    await dynamoClient.send(
      new PutCommand({
        TableName: CONVERSATIONS_TABLE,
        Item: {
          PK: `CONV#${poll.conversationId}`,
          SK: `POLL#${poll.pollId}`,
          ...poll,
        },
      }),
    );
  },

  getPolls: async (conversationId: string): Promise<any[]> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: CONVERSATIONS_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pollPrefix)',
        ExpressionAttributeValues: {
          ':pk': `CONV#${conversationId}`,
          ':pollPrefix': 'POLL#',
        },
      }),
    );
    return result.Items ?? [];
  },

  updatePollVotes: async (conversationId: string, pollId: string, options: any[]): Promise<void> => {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: `POLL#${pollId}` },
        UpdateExpression: 'SET #opt = :options, updatedAt = :now',
        ExpressionAttributeNames: { '#opt': 'options' },
        ExpressionAttributeValues: {
          ':options': options,
          ':now': new Date().toISOString(),
        },
      }),
    );
  },

  updatePoll: async (conversationId: string, pollId: string, updates: any): Promise<void> => {
    const entries = Object.entries(updates);
    const updateExpr = 'SET ' + entries.map((_, i) => `#k${i} = :v${i}`).join(', ') + ', updatedAt = :now';
    const attrNames = Object.fromEntries(entries.map(([k], i) => [`#k${i}`, k]));
    const attrValues = {
      ...Object.fromEntries(entries.map(([, v], i) => [`:v${i}`, v])),
      ':now': new Date().toISOString(),
    };

    await dynamoClient.send(
      new UpdateCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: `POLL#${pollId}` },
        UpdateExpression: updateExpr,
        ExpressionAttributeNames: attrNames,
        ExpressionAttributeValues: attrValues,
      }),
    );
  },

  deletePoll: async (conversationId: string, pollId: string): Promise<void> => {
    await dynamoClient.send(
      new DeleteCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: `POLL#${pollId}` },
      }),
    );
  },
};
