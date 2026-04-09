import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import type { IAnalyticsMetric, IModerationLog, MetricType } from './admin.types.js';

const ANALYTICS_TABLE = 'Zalogram_Analytics';
const MODERATION_LOGS_TABLE = 'Zalogram_ModerationLogs';

export const adminRepository = {
  getAnalytics: async (metricType: MetricType, from?: string, to?: string): Promise<IAnalyticsMetric[]> => {
    const keyCondition = to
      ? 'PK = :pk AND SK BETWEEN :from AND :to'
      : 'PK = :pk';

    const expressionValues: Record<string, string> = {
      ':pk': `ANALYTICS#${metricType}`,
    };

    if (from) expressionValues[':from'] = `DATE#${from}`;
    if (to) expressionValues[':to'] = `DATE#${to}`;

    const result = await dynamoClient.send(new QueryCommand({
      TableName: ANALYTICS_TABLE,
      KeyConditionExpression: keyCondition,
      ExpressionAttributeValues: expressionValues,
      ScanIndexForward: false,
    }));
    return (result.Items as IAnalyticsMetric[]) ?? [];
  },

  createModerationLog: async (log: IModerationLog): Promise<void> => {
    await dynamoClient.send(new PutCommand({
      TableName: MODERATION_LOGS_TABLE,
      Item: {
        PK: `ADMIN#${log.adminId}`,
        SK: `LOG#${log.createdAt}#${log.logId}`,
        ...log,
      },
    }));
  },

  getModerationLogs: async (adminId?: string, limit: number = 50): Promise<IModerationLog[]> => {
    const pk = adminId ? `ADMIN#${adminId}` : 'LOGS#ALL';
    const result = await dynamoClient.send(new QueryCommand({
      TableName: MODERATION_LOGS_TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': pk },
      Limit: limit,
      ScanIndexForward: false,
    }));
    return (result.Items as IModerationLog[]) ?? [];
  },
};
