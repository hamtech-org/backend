#!/usr/bin/env node

/**
 * Script to sync users from DynamoDB to Elasticsearch
 * Usage: node dist/scripts/database/sync-users-to-es.js
 */

import { dynamoClient } from '@/config/database.js';
import { elasticsearchUtils } from '@/shared/utils/elasticsearch.js';
import { logger } from '@/shared/utils/logger.js';
import { esClient } from '@/config/elasticsearch.js';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';

const BATCH_SIZE = 100;
const TABLE_PREFIX = process.env.DYNAMODB_TABLE_PREFIX ?? 'Zalogram_';
const TABLE_NAME = `${TABLE_PREFIX}Users`;

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
    await elasticsearchUtils.initializeUsersIndex();

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
        await elasticsearchUtils.bulkIndexUsers(usersToIndex);
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
    await elasticsearchUtils.refreshIndex('users');

    logger.info(`Sync completed successfully! Total users indexed: ${totalUsers}`);
  } catch (error) {
    logger.error('Error syncing users to Elasticsearch:', error);
    process.exit(1);
  }
}

// Run the script
void syncUsersToElasticsearch();
