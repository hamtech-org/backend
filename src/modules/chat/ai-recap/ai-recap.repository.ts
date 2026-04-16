import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';

const CONVERSATIONS_TABLE = 'Zalogram_Conversations';

export const aiRecapRepository = {
  saveAISummary: async (conversationId: string, summary: any): Promise<void> => {
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

  getLatestAISummary: async (conversationId: string): Promise<any | null> => {
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
    return result.Items?.[0] ?? null;
  },
};
