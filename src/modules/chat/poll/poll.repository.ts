import { PutCommand, QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import { env } from '@/config/env.js';

const CONVERSATIONS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Conversations`;
type PollOption = Record<string, unknown> & {
  text: string;
  voters: string[];
};
type PollRecord = Record<string, unknown> & {
  conversationId: string;
  pollId: string;
  options: PollOption[];
};

export const pollRepository = {
  createPoll: async (poll: PollRecord): Promise<void> => {
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

  getPolls: async (conversationId: string): Promise<PollRecord[]> => {
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
    return (result.Items as PollRecord[]) ?? [];
  },

  updatePollVotes: async (
    conversationId: string,
    pollId: string,
    options: PollOption[],
  ): Promise<void> => {
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

  updatePoll: async (
    conversationId: string,
    pollId: string,
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
