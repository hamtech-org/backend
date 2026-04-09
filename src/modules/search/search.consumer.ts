import { logger } from '@/shared/utils/logger.js';

const TOPIC = 'search.index';

interface ISearchIndexEvent {
  action: 'index' | 'update' | 'delete';
  indexName: string;
  documentId: string;
  document: Record<string, unknown> | null;
}

export const startSearchConsumer = async (): Promise<void> => {
  // TODO: Khởi tạo Kafka consumer, subscribe vào topic
  // const consumer = kafka.consumer({ groupId: 'search-indexer' });
  // await consumer.connect();
  // await consumer.subscribe({ topic: TOPIC, fromBeginning: false });

  logger.info(`Search consumer đã subscribe topic: ${TOPIC}`);

  // TODO: Xử lý từng message để đồng bộ dữ liệu vào Elasticsearch
  // await consumer.run({
  //   eachMessage: async ({ message }) => {
  //     const event = JSON.parse(message.value!.toString()) as ISearchIndexEvent;
  //     switch (event.action) {
  //       case 'index':
  //       case 'update':
  //         // await esClient.index({ index: event.indexName, id: event.documentId, body: event.document });
  //         break;
  //       case 'delete':
  //         // await esClient.delete({ index: event.indexName, id: event.documentId });
  //         break;
  //     }
  //   },
  // });

  void TOPIC;
};
