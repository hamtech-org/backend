import { GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import { env } from '@/config/env.js';
import type { IMedia } from './media.types.js';

const TABLE_NAME = `${env.DYNAMODB_TABLE_PREFIX}Media`;

export const mediaRepository = {
  findById: async (mediaId: string): Promise<IMedia | null> => {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: `MEDIA#${mediaId}`, SK: 'META' },
      }),
    );
    return (result.Item as IMedia) ?? null;
  },

  create: async (media: IMedia): Promise<void> => {
    await dynamoClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: { PK: `MEDIA#${media.mediaId}`, SK: 'META', ...media },
      }),
    );
  },

  delete: async (mediaId: string): Promise<void> => {
    await dynamoClient.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { PK: `MEDIA#${mediaId}`, SK: 'META' },
      }),
    );
  },
};
