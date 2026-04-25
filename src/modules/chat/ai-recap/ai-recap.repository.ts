import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import { env } from '@/config/env.js';

const CONVERSATIONS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Conversations`;
type IAISummaryRecord = Record<string, unknown> & {
  summaryId: string;
  conversationId: string;
  content: string;
  createdAt: string;
};

export const aiRecapRepository = {
  saveAISummary: async (conversationId: string, summary: IAISummaryRecord): Promise<void> => {
    await dynamoClient.send(
      new PutCommand({
        TableName: CONVERSATIONS_TABLE,
        Item: {
          PK: `CONV#${conversationId}`,
          SK: `SUMMARY#${summary.summaryId}`,
          ...summary,
        },
      }),
    );
  },

  getLatestAISummary: async (conversationId: string): Promise<IAISummaryRecord | null> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: CONVERSATIONS_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :summaryPrefix)',
        ExpressionAttributeValues: {
          ':pk': `CONV#${conversationId}`,
          ':summaryPrefix': 'SUMMARY#',
        },
        ScanIndexForward: false,
        Limit: 1,
      }),
    );
    return (result.Items?.[0] as IAISummaryRecord | undefined) ?? null;
  },
};
