#!/usr/bin/env node

/**
 * Script to sync groups/communities from DynamoDB to Elasticsearch
 * Usage: node dist/scripts/database/sync-groups-to-es.js
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { Client } from '@elastic/elasticsearch';
import { logger } from '@/shared/utils/logger.js';

const BATCH_SIZE = 100;
const TABLE_PREFIX = process.env.DYNAMODB_TABLE_PREFIX ?? 'Zalogram_';
const TABLE_NAME = `${TABLE_PREFIX}Groups`;
const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';
const DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT?.trim();
const ELASTICSEARCH_NODE = process.env.ELASTICSEARCH_NODE?.trim() ?? 'http://localhost:9200';
const ELASTICSEARCH_USERNAME = process.env.ELASTICSEARCH_USERNAME ?? '';
const ELASTICSEARCH_PASSWORD = process.env.ELASTICSEARCH_PASSWORD ?? '';

interface IGroup {
  groupId: string;
  communityId?: string;
  name: string;
  description?: string | null;
  slug?: string;
  avatar?: string | null;
  coverUrl?: string | null;
  category?: string;
  memberCount?: number;
  type?: string;
  status?: string;
  isActive?: boolean;
  createdAt?: string;
}

type DynamoRecord = Record<string, unknown>;

const dynamoConfig: ConstructorParameters<typeof DynamoDBClient>[0] = {
  region: AWS_REGION,
};

if (DYNAMODB_ENDPOINT) {
  dynamoConfig.endpoint = DYNAMODB_ENDPOINT;
}

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

function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function toGroup(item: DynamoRecord): IGroup | null {
  if (item['SK'] !== 'META') {
    return null;
  }

  const groupId = item['groupId'];
  const name = item['name'];

  if (typeof groupId !== 'string' || typeof name !== 'string') {
    return null;
  }

  return {
    groupId,
    communityId: toOptionalString(item['communityId']) ?? groupId,
    name,
    description: toNullableString(item['description']),
    slug: toOptionalString(item['slug']),
    avatar: toNullableString(item['avatar']),
    coverUrl: toNullableString(item['coverUrl']),
    category: toOptionalString(item['category']) ?? 'general',
    memberCount: toOptionalNumber(item['memberCount']) ?? 1,
    type: toOptionalString(item['type']) ?? 'public',
    status: toOptionalString(item['status']) ?? 'active',
    isActive: toOptionalBoolean(item['isActive']) ?? true,
    createdAt: toOptionalString(item['createdAt']),
  };
}

async function syncGroupsToElasticsearch(): Promise<void> {
  try {
    logger.info(`Sync source DynamoDB table: ${TABLE_NAME}`);
    logger.info(`Sync target Elasticsearch node: ${ELASTICSEARCH_NODE}`);

    // Check if groups index already exists with data
    try {
      const countResult = await esClient.count({ index: 'groups' });
      if (countResult.count > 0 && process.env.FORCE !== 'true') {
        logger.info(
          `Elasticsearch index 'groups' already has ${countResult.count} documents. Skipping sync. Use FORCE=true to force-sync.`,
        );
        return;
      }
    } catch (error) {
      logger.debug('Index does not exist yet, will create it');
    }

    logger.info('Starting to sync groups/communities from DynamoDB to Elasticsearch...');

    // Initialize Elasticsearch index
    await initializeGroupsIndex();

    let lastEvaluatedKey: Record<string, unknown> | undefined;
    let totalGroups = 0;
    let batchCount = 0;
    let hasMore = true;

    while (hasMore) {
      // Scan DynamoDB table
      const result = await dynamoClient.send(
        new ScanCommand({
          TableName: TABLE_NAME,
          ExclusiveStartKey: lastEvaluatedKey,
          Limit: BATCH_SIZE,
        }),
      );

      const rawItems: unknown = result.Items;
      if (!Array.isArray(rawItems) || rawItems.length === 0) {
        break;
      }
      const items = rawItems.filter((item): item is DynamoRecord => {
        return typeof item === 'object' && item !== null;
      });

      // Filter and prepare groups for indexing
      const groupsToIndex: IGroup[] = items
        .map(toGroup)
        .filter((group): group is IGroup => group !== null);

      if (groupsToIndex.length > 0) {
        // Bulk index groups
        await bulkIndexGroups(groupsToIndex);
        totalGroups += groupsToIndex.length;
        batchCount++;

        logger.info(
          `Processed batch ${batchCount}: ${groupsToIndex.length} groups (Total: ${totalGroups})`,
        );
      }

      // Check if there are more items
      const rawLastEvaluatedKey: unknown = result.LastEvaluatedKey;
      lastEvaluatedKey =
        typeof rawLastEvaluatedKey === 'object' && rawLastEvaluatedKey !== null
          ? (rawLastEvaluatedKey as Record<string, unknown>)
          : undefined;
      hasMore = Boolean(lastEvaluatedKey);
    }

    // Refresh index
    await refreshIndex('groups');

    logger.info(`Sync completed successfully! Total groups/communities indexed: ${totalGroups}`);
  } catch (error) {
    logger.error('Error syncing groups/communities to Elasticsearch:', error);
    process.exit(1);
  }
}

async function initializeGroupsIndex(): Promise<void> {
  const indexName = 'groups';
  const existsResponse = await esClient.indices.exists({ index: indexName });

  if (existsResponse) {
    logger.info(`Elasticsearch index '${indexName}' already exists`);
    return;
  }

  await esClient.indices.create({
    index: indexName,
    mappings: {
      properties: {
        groupId: { type: 'keyword' },
        name: {
          type: 'text',
          analyzer: 'standard',
          fields: { keyword: { type: 'keyword' } },
        },
        description: { type: 'text', analyzer: 'standard' },
        slug: { type: 'keyword' },
        category: { type: 'keyword' },
        avatar: { type: 'keyword', index: false },
        coverUrl: { type: 'keyword', index: false },
        memberCount: { type: 'integer' },
        type: { type: 'keyword' },
        status: { type: 'keyword' },
        isActive: { type: 'boolean' },
        createdAt: { type: 'date' },
      },
    },
    settings: {
      number_of_shards: 1,
      number_of_replicas: 0,
    },
  });

  logger.info(`Elasticsearch index '${indexName}' created successfully`);
}

async function bulkIndexGroups(groups: IGroup[]): Promise<void> {
  const body = groups.flatMap((group) => [
    { index: { _index: 'groups', _id: group.groupId } },
    group,
  ]);
  const result = await esClient.bulk({ body });

  if (result.errors) {
    logger.warn(`Some documents failed to index: ${JSON.stringify(result.items)}`);
  } else {
    logger.info(`Successfully indexed ${groups.length} groups/communities`);
  }
}

async function refreshIndex(indexName: string): Promise<void> {
  await esClient.indices.refresh({ index: indexName });
  logger.debug(`Index '${indexName}' refreshed`);
}

// Run the script
void syncGroupsToElasticsearch();
