import { esClient } from '@/config/elasticsearch.js';
import { logger } from './logger.js';

/**
 * Elasticsearch utilities for managing indices and documents
 */
export const elasticsearchUtils = {
  /**
   * Initialize users index with proper mappings
   */
  initializeUsersIndex: async (): Promise<void> => {
    const indexName = 'users';

    try {
      // Check if index exists
      const existsResponse = await esClient.indices.exists({ index: indexName });

      if (existsResponse) {
        logger.info(`Elasticsearch index '${indexName}' already exists`);
        return;
      }

      // Create index with proper mappings
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
    } catch (error) {
      logger.error(`Failed to initialize Elasticsearch index '${indexName}':`, error);
      throw error;
    }
  },

  /**
   * Initialize groups index
   */
  initializeGroupsIndex: async (): Promise<void> => {
    const indexName = 'groups';
    try {
      const exists = await esClient.indices.exists({ index: indexName });
      if (exists) return;

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
            memberCount: { type: 'integer' },
            type: { type: 'keyword' },
          },
        },
        settings: {
          number_of_shards: 1,
          number_of_replicas: 0,
        },
      });
      logger.info(`Elasticsearch index '${indexName}' created successfully`);
    } catch (error) {
      logger.error(`Failed to initialize '${indexName}' index:`, error);
    }
  },

  /**
   * Initialize posts index
   */
  initializePostsIndex: async (): Promise<void> => {
    const indexName = 'posts';
    try {
      const exists = await esClient.indices.exists({ index: indexName });
      if (exists) return;

      await esClient.indices.create({
        index: indexName,
        mappings: {
          properties: {
            postId: { type: 'keyword' },
            authorId: { type: 'keyword' },
            content: { type: 'text', analyzer: 'standard' },
            type: { type: 'keyword' },
            createdAt: { type: 'date' },
          },
        },
        settings: {
          number_of_shards: 1,
          number_of_replicas: 0,
        },
      });
      logger.info(`Elasticsearch index '${indexName}' created successfully`);
    } catch (error) {
      logger.error(`Failed to initialize '${indexName}' index:`, error);
    }
  },

  /**
   * Initialize messages index
   */
  initializeMessagesIndex: async (): Promise<void> => {
    const indexName = 'messages';
    try {
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
        settings: {
          number_of_shards: 1,
          number_of_replicas: 0,
        },
      });
      logger.info(`Elasticsearch index '${indexName}' created successfully`);
    } catch (error) {
      logger.error(`Failed to initialize '${indexName}' index:`, error);
    }
  },

  /**
   * Initialize all required indices
   */
  initializeAllIndices: async (): Promise<void> => {
    logger.info('Initializing Elasticsearch indices...');
    await Promise.all([
      elasticsearchUtils.initializeUsersIndex(),
      elasticsearchUtils.initializeGroupsIndex(),
      elasticsearchUtils.initializePostsIndex(),
      elasticsearchUtils.initializeMessagesIndex(),
    ]);
  },

  /**
   * Index a user document
   */
  indexUser: async (userId: string, userData: Record<string, unknown>): Promise<void> => {
    try {
      await esClient.index({
        index: 'users',
        id: userId,
        document: userData,
      });
      logger.debug(`User ${userId} indexed successfully`);
    } catch (error) {
      logger.error(`Failed to index user ${userId}:`, error);
      throw error;
    }
  },

  /**
   * Update a user document
   */
  updateUser: async (userId: string, userData: Record<string, unknown>): Promise<void> => {
    try {
      await esClient.update({
        index: 'users',
        id: userId,
        doc: userData,
      });
      logger.debug(`User ${userId} updated successfully`);
    } catch (error) {
      logger.error(`Failed to update user ${userId}:`, error);
      throw error;
    }
  },

  /**
   * Delete a user document
   */
  deleteUser: async (userId: string): Promise<void> => {
    try {
      await esClient.delete({
        index: 'users',
        id: userId,
      });
      logger.debug(`User ${userId} deleted successfully`);
    } catch (error) {
      logger.error(`Failed to delete user ${userId}:`, error);
      throw error;
    }
  },

  /**
   * Bulk index users
   */
  bulkIndexUsers: async (
    users: Array<{ userId: string; [key: string]: unknown }>,
  ): Promise<void> => {
    try {
      const body = users.flatMap((user) => [
        { index: { _index: 'users', _id: user.userId } },
        user,
      ]);

      const result = await esClient.bulk({ body });

      if (result.errors) {
        logger.warn(`Some documents failed to index: ${JSON.stringify(result.items)}`);
      } else {
        logger.info(`Successfully indexed ${users.length} users`);
      }
    } catch (error) {
      logger.error('Failed to bulk index users:', error);
      throw error;
    }
  },

  /**
   * Refresh index
   */
  refreshIndex: async (indexName: string = 'users'): Promise<void> => {
    try {
      await esClient.indices.refresh({ index: indexName });
      logger.debug(`Index '${indexName}' refreshed`);
    } catch (error) {
      logger.error(`Failed to refresh index '${indexName}':`, error);
      throw error;
    }
  },
};
