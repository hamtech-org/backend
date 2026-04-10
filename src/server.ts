import http from 'http';
import { app } from './app.js';
import { env } from '@/config/env.js';
import { logger } from '@/shared/utils/logger.js';
import { initializeSocket } from '@/socket/index.js';
import { connectRedis } from '@/config/redis.js';
import { connectKafka } from '@/config/kafka.js';
import { ensureCollectionExists } from '@/shared/utils/rekognition.js';

const server = http.createServer(app);

const startServer = async (): Promise<void> => {
  try {
    await connectRedis();
    await connectKafka();
    await ensureCollectionExists();
    initializeSocket(server);

    server.listen(env.PORT, () => {
      logger.info(`Zalogram Backend đang chạy tại port ${env.PORT} [${env.NODE_ENV}]`);
    });
  } catch (error) {
    logger.error('Không thể khởi động server:', error);
    process.exit(1);
  }
};

startServer();

export { server };
