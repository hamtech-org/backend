import { kafka } from '@/config/kafka.js';
import { logger } from '@/shared/utils/logger.js';
import { elasticsearchUtils } from '@/shared/utils/elasticsearch.js';

interface ISearchIndexEvent {
  action: 'index' | 'update' | 'delete';
  indexName: 'users' | 'posts' | 'messages' | 'groups';
  documentId: string;
  document: Record<string, unknown> | null;
}

export const startSearchConsumer = async (): Promise<void> => {
  const consumer = kafka.consumer({ groupId: 'search-indexer' });

  await consumer.connect();
  await consumer.subscribe({ topic: 'search.index', fromBeginning: false });

  logger.info('🔍 Search consumer started, listening for index updates...');

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const event = JSON.parse(message.value!.toString()) as ISearchIndexEvent;

        logger.debug(`Processing ${event.action} event for ${event.indexName}/${event.documentId}`);

        switch (event.action) {
          case 'index':
          case 'update':
            if (event.indexName === 'users') {
              await elasticsearchUtils.indexUser(event.documentId, event.document || {});
            } else if (event.indexName === 'messages') {
              await elasticsearchUtils.indexMessage(event.documentId, event.document || {});
            } else if (event.indexName === 'groups') {
              await elasticsearchUtils.indexGroup(event.documentId, event.document || {});
            }
            if (event.indexName === 'posts') {
              if (event.action === 'index') {
                await elasticsearchUtils.indexPost(event.documentId, event.document || {});
              } else {
                await elasticsearchUtils.updatePost(event.documentId, event.document || {});
              }
            }
            if (event.indexName === 'messages' && event.action === 'index') {
              await elasticsearchUtils.indexMessage(event.documentId, event.document || {});
            }
            break;
          case 'delete':
            if (event.indexName === 'users') {
              await elasticsearchUtils.deleteUser(event.documentId);
            } else if (event.indexName === 'messages') {
              await elasticsearchUtils.deleteMessage(event.documentId);
            } else if (event.indexName === 'groups') {
              await elasticsearchUtils.deleteGroup(event.documentId);
            }
            if (event.indexName === 'posts') {
              await elasticsearchUtils.deletePost(event.documentId);
            }
            if (event.indexName === 'messages') {
              await elasticsearchUtils.deleteMessage(event.documentId);
            }
            break;
        }

        logger.debug(`Successfully processed ${event.action} for ${event.documentId}`);
      } catch (error) {
        logger.error('Error processing search index event:', error);
      }
    },
  });
};
