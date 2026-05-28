import { Client } from '@elastic/elasticsearch';
import { env } from './env.js';
import { logger } from '@/shared/utils/logger.js';

export const esClient = new Client({
  node: env.ELASTICSEARCH_NODE,
  ...(env.ELASTICSEARCH_USERNAME && {
    auth: {
      username: env.ELASTICSEARCH_USERNAME,
      password: env.ELASTICSEARCH_PASSWORD,
    },
  }),
});

export const pingElasticsearch = async (): Promise<boolean> => {
  try {
    await esClient.ping();
    logger.info('Elasticsearch kết nối thành công');
    return true;
  } catch (error) {
    logger.warn('Elasticsearch không khả dụng:', error);
    return false;
  }
};
