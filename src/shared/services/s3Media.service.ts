import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@/config/env.js';

const s3Client = new S3Client({
  region: env.S3_REGION,
  ...(env.AWS_ACCESS_KEY_ID
    ? {
        credentials: {
          accessKeyId: env.AWS_ACCESS_KEY_ID,
          secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        },
      }
    : {}),
});

const bucket = env.S3_BUCKET_NAME;

export async function putObject(params: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<void> {
  const input: PutObjectCommandInput = {
    Bucket: bucket,
    Key: params.key,
    Body: params.body,
    ContentType: params.contentType,
  };
  await s3Client.send(new PutObjectCommand(input));
}

export async function deleteObjectKey(key: string): Promise<void> {
  await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function getSignedGetUrl(key: string, expiresInSeconds = 900): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3Client, cmd, { expiresIn: expiresInSeconds });
}
