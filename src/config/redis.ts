import Redis from 'ioredis';
import { env } from './env.js';
import { logger } from '@/shared/utils/logger.js';

let redis: Redis;

export const connectRedis = async (): Promise<void> => {
  redis = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    retryStrategy: (times) => Math.min(times * 50, 2000),
  });

  redis.on('connect', () => logger.info('Redis kết nối thành công'));
  redis.on('error', (err) => logger.error('Redis lỗi:', err));
};

export const getRedis = (): Redis => {
  if (!redis) throw new Error('Redis chưa được khởi tạo');
  return redis;
};
