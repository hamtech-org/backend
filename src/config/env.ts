import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  API_VERSION: z.string().default('v1'),

  JWT_PRIVATE_KEY: z.string().min(1),
  JWT_PUBLIC_KEY: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(1),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(1),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),

  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_CALLBACK_URL: z.string().default(''),
  FACEBOOK_APP_ID: z.string().default(''),
  FACEBOOK_APP_SECRET: z.string().default(''),
  FACEBOOK_CALLBACK_URL: z.string().default(''),

  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().default(''),
  AWS_SECRET_ACCESS_KEY: z.string().default(''),

  DYNAMODB_ENDPOINT: z.string().optional(),
  DYNAMODB_TABLE_PREFIX: z.string().default('Zalogram_'),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().default(''),

  KAFKA_BROKERS: z.string().default('localhost:9092'),
  KAFKA_CLIENT_ID: z.string().default('zalogram-backend'),
  KAFKA_GROUP_ID: z.string().default('zalogram-consumer-group'),

  ELASTICSEARCH_NODE: z.string().default('http://localhost:9200'),
  ELASTICSEARCH_USERNAME: z.string().default(''),
  ELASTICSEARCH_PASSWORD: z.string().default(''),

  S3_BUCKET_NAME: z.string().default('zalogram-media'),
  S3_REGION: z.string().default('us-east-1'),
  CLOUDFRONT_DOMAIN: z.string().default(''),

  SES_FROM_EMAIL: z.string().default('noreply@zalogram.vn'),
  SES_REGION: z.string().default('us-east-1'),
  SNS_REGION: z.string().default('us-east-1'),

  GOOGLE_GEMINI_API_KEY: z.string().default(''),

  REKOGNITION_COLLECTION_ID: z.string().default('zalogram-faces'),
  REKOGNITION_FACE_MATCH_THRESHOLD: z.coerce.number().default(95),

  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
