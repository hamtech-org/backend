#!/usr/bin/env node

/**
 * Script to sync users from DynamoDB to Elasticsearch
 * Usage: node dist/scripts/database/sync-users-to-es.js
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { Client } from '@elastic/elasticsearch';
import { logger } from '@/shared/utils/logger.js';

const BATCH_SIZE = 100;
const TABLE_PREFIX = process.env.DYNAMODB_TABLE_PREFIX ?? 'Zalogram_';
const TABLE_NAME = `${TABLE_PREFIX}Users`;
const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';
const DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT?.trim();
const ELASTICSEARCH_NODE = process.env.ELASTICSEARCH_NODE?.trim();
const ELASTICSEARCH_USERNAME = process.env.ELASTICSEARCH_USERNAME ?? '';
const ELASTICSEARCH_PASSWORD = process.env.ELASTICSEARCH_PASSWORD ?? '';

interface IUser {
  userId: string;
  displayName: string;
  email: string;
  avatar?: string | null;
  bio?: string | null;
  status?: string;
  isVerified?: boolean;
  createdAt?: string;
  updatedAt?: string;
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

if (!ELASTICSEARCH_NODE) {
  throw new Error('ELASTICSEARCH_NODE is required to sync users to Elasticsearch');
}

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

function toUser(item: DynamoRecord): IUser | null {
  if (item['SK'] !== 'PROFILE') {
    return null;
  }

  const userId = item['userId'];
  const displayName = item['displayName'];
  const email = item['email'];

  if (typeof userId !== 'string' || typeof displayName !== 'string' || typeof email !== 'string') {
    return null;
  }

  return {
    userId,
    displayName,
    email,
    avatar: toNullableString(item['avatar']),
    bio: toNullableString(item['bio']),
    status: toOptionalString(item['status']),
    isVerified: toOptionalBoolean(item['isVerified']) ?? false,
    createdAt: toOptionalString(item['createdAt']),
    updatedAt: toOptionalString(item['updatedAt']),
  };
}

async function syncUsersToElasticsearch(): Promise<void> {
  try {
    logger.info(`Sync source DynamoDB table: ${TABLE_NAME}`);
    logger.info(`Sync target Elasticsearch node: ${ELASTICSEARCH_NODE}`);

    // Check if users index already exists with data
    try {
      const countResult = await esClient.count({ index: 'users' });
      if (countResult.count > 0) {
        logger.info(
          `Elasticsearch index 'users' already has ${countResult.count} documents. Skipping sync.`,
        );
        return;
      }
    } catch (error) {
      logger.debug('Index does not exist yet, will create it');
    }

    logger.info('Starting to sync users from DynamoDB to Elasticsearch...');

    // Initialize Elasticsearch index
    await initializeUsersIndex();

    let lastEvaluatedKey: Record<string, unknown> | undefined;
    let totalUsers = 0;
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

      // Filter and prepare users for indexing
      const usersToIndex: IUser[] = items
        .map(toUser)
        .filter((user): user is IUser => user !== null);

      if (usersToIndex.length > 0) {
        // Bulk index users
        await bulkIndexUsers(usersToIndex);
        totalUsers += usersToIndex.length;
        batchCount++;

        logger.info(
          `Processed batch ${batchCount}: ${usersToIndex.length} users (Total: ${totalUsers})`,
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
    await refreshIndex('users');

    logger.info(`Sync completed successfully! Total users indexed: ${totalUsers}`);
  } catch (error) {
    logger.error('Error syncing users to Elasticsearch:', error);
    process.exit(1);
  }
}

async function initializeUsersIndex(): Promise<void> {
  const indexName = 'users';
  const existsResponse = await esClient.indices.exists({ index: indexName });

  if (existsResponse) {
    logger.info(`Elasticsearch index '${indexName}' already exists`);
    return;
  }

  await esClient.indices.create({
    index: indexName,
    mappings: {
      properties: {
        userId: { type: 'keyword' },
        displayName: {
          type: 'text',
          analyzer: 'standard',
          fields: {
            keyword: { type: 'keyword' },
            suggest: { type: 'completion' },
          },
        },
        email: {
          type: 'text',
          analyzer: 'standard',
          fields: {
            keyword: { type: 'keyword' },
          },
        },
        avatar: { type: 'keyword' },
        bio: { type: 'text' },
        status: { type: 'keyword' },
        isVerified: { type: 'boolean' },
        createdAt: { type: 'date' },
        updatedAt: { type: 'date' },
      },
    },
    settings: {
      number_of_shards: 1,
      number_of_replicas: 0,
      analysis: {
        analyzer: {
          standard: {
            type: 'standard',
            stopwords: '_english_',
          },
        },
      },
    },
  });

  logger.info(`Elasticsearch index '${indexName}' created successfully`);
}

async function bulkIndexUsers(users: IUser[]): Promise<void> {
  const body = users.flatMap((user) => [{ index: { _index: 'users', _id: user.userId } }, user]);
  const result = await esClient.bulk({ body });

  if (result.errors) {
    logger.warn(`Some documents failed to index: ${JSON.stringify(result.items)}`);
  } else {
    logger.info(`Successfully indexed ${users.length} users`);
  }
}

async function refreshIndex(indexName: string): Promise<void> {
  await esClient.indices.refresh({ index: indexName });
  logger.debug(`Index '${indexName}' refreshed`);
}

// Run the script
void syncUsersToElasticsearch();
