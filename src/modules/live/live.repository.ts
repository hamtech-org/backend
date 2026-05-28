import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import crypto from 'crypto';
import { dynamoClient } from '@/config/database.js';
import { env } from '@/config/env.js';
import type { ILiveSessionMeta } from './live.types.js';

const TABLE = `${env.DYNAMODB_TABLE_PREFIX}LiveSessions`;

const pkSession = (sessionId: string): string => `SESSION#${sessionId}`;

export const buildLiveChannelName = (sessionId: string): string => {
  const h = crypto.createHash('md5').update(sessionId).digest('hex').substring(0, 16);
  return `live_${h}`;
};

export const liveRepository = {
  findMetaById: async (sessionId: string): Promise<ILiveSessionMeta | null> => {
    const res = await dynamoClient.send(
      new GetCommand({
        TableName: TABLE,
        Key: { PK: pkSession(sessionId), SK: 'META' },
      }),
    );
    const item = res.Item;
    if (!item || item.SK !== 'META') return null;
    return item as ILiveSessionMeta;
  },

  findMetaByChannelName: async (channelName: string): Promise<ILiveSessionMeta | null> => {
    const res = await dynamoClient.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI-2',
        KeyConditionExpression: 'GSI2PK = :ch',
        ExpressionAttributeValues: { ':ch': channelName },
        Limit: 1,
      }),
    );
    const first = res.Items?.[0];
    if (!first || first.SK !== 'META') return null;
    return first as ILiveSessionMeta;
  },

  listActive: async (limit = 50): Promise<ILiveSessionMeta[]> => {
    const res = await dynamoClient.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI-1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': 'live#active' },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (res.Items ?? []) as ILiveSessionMeta[];
  },

  putMeta: async (meta: ILiveSessionMeta): Promise<void> => {
    await dynamoClient.send(
      new PutCommand({
        TableName: TABLE,
        Item: meta as unknown as Record<string, unknown>,
      }),
    );
  },

  updateMeta: async (
    sessionId: string,
    updates: Partial<
      Pick<
        ILiveSessionMeta,
        | 'title'
        | 'category'
        | 'coverImageUrl'
        | 'coverColor'
        | 'status'
        | 'endedAt'
        | 'GSI1PK'
        | 'GSI1SK'
        | 'GSI2PK'
        | 'GSI2SK'
      >
    >,
  ): Promise<ILiveSessionMeta> => {
    const keys = Object.keys(updates).filter((k) => (updates as never)[k] !== undefined);
    if (keys.length === 0) {
      const cur = await liveRepository.findMetaById(sessionId);
      if (!cur) throw new Error('SESSION_NOT_FOUND');
      return cur;
    }
    let expr = 'SET ';
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    keys.forEach((k, i) => {
      const nk = `#k${i}`;
      const vk = `:v${i}`;
      names[nk] = k;
      expr += `${i > 0 ? ', ' : ''}${nk} = ${vk}`;
      values[vk] = (updates as Record<string, unknown>)[k];
    });
    const res = await dynamoClient.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: pkSession(sessionId), SK: 'META' },
        UpdateExpression: expr,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      }),
    );
    return res.Attributes as ILiveSessionMeta;
  },

  markSessionEnded: async (sessionId: string, endedAt: string): Promise<void> => {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: pkSession(sessionId), SK: 'META' },
        UpdateExpression: 'SET #st = :ended, endedAt = :ea REMOVE GSI1PK, GSI1SK',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: {
          ':ended': 'ended',
          ':ea': endedAt,
        },
      }),
    );
  },
};
