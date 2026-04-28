import { S3Client } from '@aws-sdk/client-s3';
import { env } from './env.js';

export const s3Client = new S3Client({
  region: env.S3_REGION,
  ...(env.AWS_ACCESS_KEY_ID && {
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  }),
});

export const S3_BUCKET = env.S3_BUCKET_NAME;
export const CLOUDFRONT_URL = env.CLOUDFRONT_DOMAIN ? `https://${env.CLOUDFRONT_DOMAIN}` : '';
export const CLOUDFRONT_PUBLIC_URL = env.CLOUDFRONT_PUBLIC_DOMAIN
  ? `https://${env.CLOUDFRONT_PUBLIC_DOMAIN}`
  : '';
export const CLOUDFRONT_PRIVATE_URL = env.CLOUDFRONT_PRIVATE_DOMAIN
  ? `https://${env.CLOUDFRONT_PRIVATE_DOMAIN}`
  : '';
