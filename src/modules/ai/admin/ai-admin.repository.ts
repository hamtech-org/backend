import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { dynamoClient } from '@/config/database.js';
import { env } from '@/config/env.js';
import type { AiAdminConfig, AiConfigAudit, AiUsageLog } from './ai-admin.types.js';

const TABLE = `${env.DYNAMODB_TABLE_PREFIX}AiAssistant`;
const CONFIG_KEY = { PK: 'AIADMIN#CONFIG', SK: 'ACTIVE' };

export type StoredAiAdminConfig = AiAdminConfig & {
  encryptedBedrockAccessKeyId?: string;
  encryptedBedrockSecretAccessKey?: string;
  encryptedOpenAiApiKey?: string;
  encryptedQdrantApiKey?: string;
};

function usagePk(date: string) {
  return `AIADMIN#USAGE#${date}`;
}

export const aiAdminRepository = {
  getConfig: async (): Promise<StoredAiAdminConfig | null> => {
    const res = await dynamoClient.send(new GetCommand({ TableName: TABLE, Key: CONFIG_KEY }));
    return (res.Item as StoredAiAdminConfig | undefined) ?? null;
  },

  putConfig: async (config: StoredAiAdminConfig): Promise<void> => {
    await dynamoClient.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          ...CONFIG_KEY,
          ...config,
        },
      }),
    );
  },

  appendUsage: async (log: Omit<AiUsageLog, 'usageId' | 'createdAt'>): Promise<void> => {
    const createdAt = new Date().toISOString();
    const usageId = randomUUID();
    await dynamoClient.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          PK: usagePk(createdAt.slice(0, 10)),
          SK: `USAGE#${createdAt}#${usageId}`,
          usageId,
          createdAt,
          ...log,
        },
      }),
    );
  },

  listUsageByDate: async (date: string, limit = 80): Promise<AiUsageLog[]> => {
    const res = await dynamoClient.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': usagePk(date),
          ':sk': 'USAGE#',
        },
        ScanIndexForward: false,
        Limit: Math.min(Math.max(limit, 1), 200),
      }),
    );
    return (res.Items ?? []) as AiUsageLog[];
  },

  appendAudit: async (audit: Omit<AiConfigAudit, 'auditId' | 'createdAt'>): Promise<void> => {
    const createdAt = new Date().toISOString();
    const auditId = randomUUID();
    await dynamoClient.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          PK: 'AIADMIN#AUDIT',
          SK: `AUDIT#${createdAt}#${auditId}`,
          auditId,
          createdAt,
          ...audit,
        },
      }),
    );
  },

  listAudits: async (limit = 20): Promise<AiConfigAudit[]> => {
    const res = await dynamoClient.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': 'AIADMIN#AUDIT',
          ':sk': 'AUDIT#',
        },
        ScanIndexForward: false,
        Limit: Math.min(Math.max(limit, 1), 100),
      }),
    );
    return (res.Items ?? []) as AiConfigAudit[];
  },
};
