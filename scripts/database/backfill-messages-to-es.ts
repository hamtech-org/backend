#!/usr/bin/env node
/* eslint-disable no-console -- CLI backfill script */
/**
 * Backfill messages from DynamoDB -> Elasticsearch.
 *
 * - Quét table `Conversations` lấy danh sách `conversationId` từ các item SK='META'
 * - Với từng conversationId, Query table `Messages` (PK='CONV#{conversationId}')
 * - Upsert vào Elasticsearch index `messages` theo `messageId`
 *
 * Chạy (gợi ý):
 *   npx tsx scripts/database/backfill-messages-to-es.ts
 *
 * Các env (tuỳ chọn):
 *   MAX_CONVERSATIONS=1000
 *   MESSAGE_QUERY_PAGE_SIZE=200
 *   CONVERSATION_SCAN_LIMIT=200
 *   BULK_SIZE=500
 *   DRY_RUN=true
 *   FORCE=true
 */
import dotenv from 'dotenv';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { Client } from '@elastic/elasticsearch';
import { logger } from '@/shared/utils/logger.js';

dotenv.config();

const TABLE_PREFIX = process.env.DYNAMODB_TABLE_PREFIX ?? 'Zalogram_';
const CONVERSATIONS_TABLE = `${TABLE_PREFIX}Conversations`;
const MESSAGES_TABLE = `${TABLE_PREFIX}Messages`;

const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';
const DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT?.trim();

const ELASTICSEARCH_NODE = process.env.ELASTICSEARCH_NODE?.trim() ?? 'http://localhost:9200';
const ELASTICSEARCH_USERNAME = process.env.ELASTICSEARCH_USERNAME ?? '';
const ELASTICSEARCH_PASSWORD = process.env.ELASTICSEARCH_PASSWORD ?? '';

const MAX_CONVERSATIONS = Number(process.env.MAX_CONVERSATIONS ?? '');
const MAX_CONVERSATIONS_EFFECTIVE = Number.isFinite(MAX_CONVERSATIONS)
  ? MAX_CONVERSATIONS
  : Number.POSITIVE_INFINITY;

const CONVERSATION_SCAN_LIMIT = Number(process.env.CONVERSATION_SCAN_LIMIT ?? 200);
const MESSAGE_QUERY_PAGE_SIZE = Number(process.env.MESSAGE_QUERY_PAGE_SIZE ?? 200);
const BULK_SIZE = Number(process.env.BULK_SIZE ?? 500);
const DRY_RUN = (process.env.DRY_RUN ?? '').toLowerCase() === 'true';
const FORCE = (process.env.FORCE ?? '').toLowerCase() === 'true';

const dynamoConfig: ConstructorParameters<typeof DynamoDBClient>[0] = {
  region: AWS_REGION,
};
if (DYNAMODB_ENDPOINT) dynamoConfig.endpoint = DYNAMODB_ENDPOINT;
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  dynamoConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(dynamoConfig), {
  marshallOptions: { removeUndefinedValues: true },
});

const esClient = new Client({
  node: ELASTICSEARCH_NODE,
  ...(ELASTICSEARCH_USERNAME && {
    auth: {
      username: ELASTICSEARCH_USERNAME,
      password: ELASTICSEARCH_PASSWORD,
    },
  }),
});

type DynamoRecord = Record<string, unknown>;

type IndexedMessage = {
  messageId: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: string;
};

function isString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function shouldIndexMessage(item: DynamoRecord): boolean {
  if (item.isRecalled === true) return false;
  if (item.isDeleted === true) return false;

  // Trùng logic lọc của `message.service.ts` để search hiển thị "đúng".
  if (String(item.type ?? '') === 'system') return false;
  if (String(item.position ?? '') === 'center') return false;

  return true;
}

async function ensureMessagesIndex(): Promise<void> {
  const indexName = 'messages';
  const exists = await esClient.indices.exists({ index: indexName });
  if (exists) return;

  await esClient.indices.create({
    index: indexName,
    mappings: {
      properties: {
        messageId: { type: 'keyword' },
        conversationId: { type: 'keyword' },
        senderId: { type: 'keyword' },
        content: { type: 'text', analyzer: 'standard' },
        createdAt: { type: 'date' },
      },
    },
  });
  logger.info(`Created Elasticsearch index '${indexName}'`);
}

async function refreshMessagesIndex(): Promise<void> {
  await esClient.indices.refresh({ index: 'messages' });
  logger.info(`Refreshed Elasticsearch index 'messages'`);
}

async function bulkUpsertMessages(docs: IndexedMessage[]): Promise<void> {
  if (docs.length === 0) return;
  if (DRY_RUN) return;

  const body = docs.flatMap((d) => [{ index: { _index: 'messages', _id: d.messageId } }, d]);

  const result = await esClient.bulk({ body });
  if (result.errors) {
    logger.warn(`Bulk upsert messages: some docs failed`, { items: result.items?.length });
  }
}

function parseConversationIdFromPk(pk: unknown): string | null {
  if (typeof pk !== 'string') return null;
  if (!pk.startsWith('CONV#')) return null;
  return pk.slice('CONV#'.length);
}

async function scanConversationIds(): Promise<string[]> {
  const ids: string[] = [];
  let lastEvaluatedKey: DynamoRecord | undefined;

  // Chỉ lấy META để lấy conversationId.
  let hasMore = true;
  while (hasMore) {
    const result = await dynamoClient.send(
      new ScanCommand({
        TableName: CONVERSATIONS_TABLE,
        ExclusiveStartKey: lastEvaluatedKey,
        Limit: CONVERSATION_SCAN_LIMIT,
        ProjectionExpression: 'PK, SK',
        FilterExpression: 'SK = :meta AND begins_with(PK, :convPrefix)',
        ExpressionAttributeValues: {
          ':meta': 'META',
          ':convPrefix': 'CONV#',
        },
      }),
    );

    const items = (result.Items ?? []) as DynamoRecord[];
    for (const item of items) {
      const convId = parseConversationIdFromPk(item.PK);
      if (!convId) continue;
      ids.push(convId);
      if (ids.length >= MAX_CONVERSATIONS_EFFECTIVE) return ids;
    }

    const rawLastEvaluatedKey: unknown = result.LastEvaluatedKey;
    lastEvaluatedKey =
      typeof rawLastEvaluatedKey === 'object' && rawLastEvaluatedKey !== null
        ? (rawLastEvaluatedKey as DynamoRecord)
        : undefined;

    if (!lastEvaluatedKey) break;

    hasMore = Boolean(lastEvaluatedKey);
  }

  return ids;
}

async function eachMessageInConversation(
  conversationId: string,
  onMessage: (doc: IndexedMessage) => Promise<void> | void,
): Promise<number> {
  const pk = `CONV#${conversationId}`;

  let lastEvaluatedKey: DynamoRecord | undefined;
  let processed = 0;

  let hasMore = true;
  while (hasMore) {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: MESSAGES_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': pk },
        ExclusiveStartKey: lastEvaluatedKey,
        Limit: MESSAGE_QUERY_PAGE_SIZE,
        ScanIndexForward: false,
      }),
    );

    const items = (result.Items ?? []) as DynamoRecord[];
    for (const item of items) {
      if (!shouldIndexMessage(item)) continue;

      const messageId = item.messageId;
      const senderId = item.senderId;
      const createdAt = item.createdAt;

      if (!isString(messageId) || !isString(senderId) || !isString(createdAt)) continue;

      const contentRaw = item.content;
      const content = typeof contentRaw === 'string' ? contentRaw : String(contentRaw ?? '');

      processed += 1;
      await onMessage({
        messageId,
        conversationId,
        senderId,
        content,
        createdAt,
      });
    }

    const rawLastEvaluatedKey: unknown = result.LastEvaluatedKey;
    lastEvaluatedKey =
      typeof rawLastEvaluatedKey === 'object' && rawLastEvaluatedKey !== null
        ? (rawLastEvaluatedKey as DynamoRecord)
        : undefined;

    if (!lastEvaluatedKey) {
      hasMore = false;
    } else {
      hasMore = true;
    }
  }

  return processed;
}

async function backfillMessagesToES(): Promise<void> {
  logger.info(
    `Backfill messages: Dynamo(${CONVERSATIONS_TABLE}, ${MESSAGES_TABLE}) -> ES(messages)`,
  );
  logger.info(
    `MAX_CONVERSATIONS=${MAX_CONVERSATIONS_EFFECTIVE}, DRY_RUN=${DRY_RUN}, FORCE=${FORCE}`,
  );

  await ensureMessagesIndex();

  if (!FORCE) {
    try {
      const countResult = await esClient.count({ index: 'messages' });
      if ((countResult.count ?? 0) > 0) {
        logger.info(
          `ES index 'messages' already has docs (${countResult.count}). Use FORCE=true to re-run.`,
        );
        return;
      }
    } catch (e) {
      logger.debug(`Skipping ES count check:`, e);
    }
  }

  const conversationIds = await scanConversationIds();
  logger.info(`Found ${conversationIds.length} conversations to backfill`);

  let totalIndexed = 0;
  let totalScannedMessages = 0;
  let batch: IndexedMessage[] = [];

  for (let i = 0; i < conversationIds.length; i++) {
    const conversationId = conversationIds[i];
    logger.info(
      `[${i + 1}/${conversationIds.length}] Backfilling conversation ${conversationId}...`,
    );

    const processedInConv = await eachMessageInConversation(conversationId, async (d) => {
      batch.push(d);
      if (batch.length >= BULK_SIZE) {
        await bulkUpsertMessages(batch);
        totalIndexed += batch.length;
        batch = [];
        logger.info(`Indexed ${totalIndexed} messages so far...`);
      }
    });

    totalScannedMessages += processedInConv;
  }

  // Flush remaining
  await bulkUpsertMessages(batch);
  totalIndexed += batch.length;

  await refreshMessagesIndex();

  logger.info(`Backfill done. Indexed=${totalIndexed}, Scanned(all kept)=${totalScannedMessages}`);
}

void backfillMessagesToES();
