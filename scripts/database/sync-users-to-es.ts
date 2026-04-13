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
const TABLE_NAME = 'Zalogram_Users';

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

async function syncUsersToElasticsearch(): Promise<void> {
  try {
    // Check if users index already exists with data
    try {
      const countResult = await esClient.count({ index: 'users' });
      if (countResult.count > 0) {
        logger.info(`Elasticsearch index 'users' already has ${countResult.count} documents. Skipping sync.`);
        return;
      }
    } catch (error) {
      logger.debug('Index does not exist yet, will create it');
    }

    logger.info('Starting to sync users from DynamoDB to Elasticsearch...');

    // Initialize Elasticsearch index
    await elasticsearchUtils.initializeUsersIndex();

    let lastEvaluatedKey: any = undefined;
    let totalUsers = 0;
    let batchCount = 0;

    while (true) {
      // Scan DynamoDB table
      const result = await dynamoClient.send(
        new ScanCommand({
          TableName: TABLE_NAME,
          ExclusiveStartKey: lastEvaluatedKey,
          Limit: BATCH_SIZE,
        })
      );

      if (!result.Items || result.Items.length === 0) {
        break;
      }

      // Filter and prepare users for indexing
      const usersToIndex: IUser[] = result.Items.filter((item: any) => item.SK === 'PROFILE').map(
        (item: any) => ({
          userId: item.userId,
          displayName: item.displayName,
          email: item.email,
          avatar: item.avatar || null,
          bio: item.bio || null,
          status: item.status,
          isVerified: item.isVerified || false,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        })
      );

      if (usersToIndex.length > 0) {
        // Bulk index users
        await elasticsearchUtils.bulkIndexUsers(usersToIndex);
        totalUsers += usersToIndex.length;
        batchCount++;

        logger.info(`Processed batch ${batchCount}: ${usersToIndex.length} users (Total: ${totalUsers})`);
      }

      // Check if there are more items
      lastEvaluatedKey = result.LastEvaluatedKey;
      if (!lastEvaluatedKey) {
        break;
      }
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
syncUsersToElasticsearch();
