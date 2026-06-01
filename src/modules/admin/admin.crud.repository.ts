import { GetCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import { env } from '@/config/env.js';
import type { IUser } from '@/modules/user/user.types.js';
import type { ICommunity } from '@/modules/community/community.types.js';
import type { IPost } from '@/modules/newsfeed/newsfeed.types.js';
import type { UserRole } from '@/shared/types/user.types.js';
import { decodeAdminCursor, encodeAdminCursor } from './admin.crud.helpers.js';

const USERS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Users`;
const GROUPS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Groups`;
const POSTS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Posts`;

const DEFAULT_PAGE = 20;
const SCAN_MULTIPLIER = 4;

async function scanUntilPage<T>(
  params: {
    TableName: string;
    FilterExpression?: string;
    ExpressionAttributeNames?: Record<string, string>;
    ExpressionAttributeValues?: Record<string, unknown>;
  },
  limit: number,
  cursor: string | undefined,
  matches: (item: T) => boolean,
): Promise<{ items: T[]; nextCursor: string | null }> {
  const pageSize = Math.min(Math.max(limit || DEFAULT_PAGE, 1), 100);
  const collected: T[] = [];
  let exclusiveStartKey = decodeAdminCursor(cursor);

  while (collected.length < pageSize) {
    const result = await dynamoClient.send(
      new ScanCommand({
        ...params,
        Limit: pageSize * SCAN_MULTIPLIER,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    const batch = (result.Items as T[]) ?? [];
    for (const item of batch) {
      if (matches(item)) collected.push(item);
      if (collected.length >= pageSize) break;
    }

    exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    if (!exclusiveStartKey || collected.length >= pageSize) {
      return {
        items: collected.slice(0, pageSize),
        nextCursor:
          collected.length >= pageSize && exclusiveStartKey
            ? encodeAdminCursor(exclusiveStartKey)
            : exclusiveStartKey
              ? encodeAdminCursor(exclusiveStartKey)
              : null,
      };
    }
  }

  return { items: collected, nextCursor: null };
}

export const adminCrudRepository = {
  scanUserProfiles: async (
    limit: number,
    cursor?: string,
    predicate?: (user: IUser) => boolean,
  ) => {
    return scanUntilPage<IUser>(
      {
        TableName: USERS_TABLE,
        FilterExpression: 'SK = :sk',
        ExpressionAttributeValues: { ':sk': 'PROFILE' },
      },
      limit,
      cursor,
      (u) => (predicate ? predicate(u) : true),
    );
  },

  scanCommunityMetas: async (limit: number, cursor?: string) => {
    return scanUntilPage<ICommunity>(
      {
        TableName: GROUPS_TABLE,
        FilterExpression: 'SK = :sk',
        ExpressionAttributeValues: { ':sk': 'META' },
      },
      limit,
      cursor,
      () => true,
    );
  },

  getCommunityMeta: async (groupId: string): Promise<ICommunity | null> => {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: GROUPS_TABLE,
        Key: { PK: `GROUP#${groupId}`, SK: 'META' },
      }),
    );
    return (result.Item as ICommunity | undefined) ?? null;
  },

  updateCommunityFields: async (
    groupId: string,
    fields: Partial<
      Pick<
        ICommunity,
        'name' | 'description' | 'avatar' | 'status' | 'isActive' | 'deletedAt' | 'deletedBy'
      >
    >,
    removeFields: Array<'deletedAt' | 'deletedBy'> = [],
  ): Promise<void> => {
    const entries = Object.entries({
      ...fields,
      updatedAt: new Date().toISOString(),
    }).filter(([, value]) => value !== undefined);

    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const setParts = entries.map(([key, value], index) => {
      const nameKey = `#k${index}`;
      const valueKey = `:v${index}`;
      names[nameKey] = key;
      values[valueKey] = value;
      return `${nameKey} = ${valueKey}`;
    });

    const removeParts = removeFields.map((field, index) => {
      const nameKey = `#r${index}`;
      names[nameKey] = field;
      return nameKey;
    });

    const updateParts: string[] = [];
    if (setParts.length > 0) updateParts.push(`SET ${setParts.join(', ')}`);
    if (removeParts.length > 0) updateParts.push(`REMOVE ${removeParts.join(', ')}`);
    if (updateParts.length === 0) return;

    await dynamoClient.send(
      new UpdateCommand({
        TableName: GROUPS_TABLE,
        Key: { PK: `GROUP#${groupId}`, SK: 'META' },
        UpdateExpression: updateParts.join(' '),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
      }),
    );
  },

  archiveCommunityAsAdmin: async (groupId: string, adminId: string): Promise<void> => {
    const now = new Date().toISOString();
    await dynamoClient.send(
      new UpdateCommand({
        TableName: GROUPS_TABLE,
        Key: { PK: `GROUP#${groupId}`, SK: 'META' },
        UpdateExpression:
          'SET isActive = :inactive, #status = :archived, deletedAt = :now, deletedBy = :by, updatedAt = :now, chatEnabled = :chatEnabled',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':inactive': false,
          ':archived': 'archived',
          ':now': now,
          ':by': adminId,
          ':chatEnabled': false,
        },
        ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
      }),
    );
  },

  scanPostMetas: async (limit: number, cursor?: string) => {
    return scanUntilPage<IPost>(
      {
        TableName: POSTS_TABLE,
        FilterExpression: 'SK = :sk',
        ExpressionAttributeValues: { ':sk': 'META' },
      },
      limit,
      cursor,
      () => true,
    );
  },

  updateUserRole: async (userId: string, role: UserRole): Promise<void> => {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
        UpdateExpression: 'SET #role = :role, updatedAt = :now',
        ExpressionAttributeNames: { '#role': 'role' },
        ExpressionAttributeValues: { ':role': role, ':now': new Date().toISOString() },
      }),
    );
  },

  softDeleteUser: async (userId: string, email: string, displayName: string): Promise<void> => {
    const now = new Date().toISOString();
    await dynamoClient.send(
      new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
        UpdateExpression:
          'SET isDeleted = :deleted, email = :email, displayName = :displayName, updatedAt = :now, GSI1PK = :gsiPk, GSI1SK = :gsiSk',
        ExpressionAttributeValues: {
          ':deleted': true,
          ':email': email,
          ':displayName': displayName,
          ':now': now,
          ':gsiPk': `EMAIL#${email}`,
          ':gsiSk': `EMAIL#${email}`,
        },
      }),
    );
  },

  updateUserFields: async (
    userId: string,
    fields: Partial<Pick<IUser, 'displayName' | 'email' | 'avatar' | 'role'>>,
  ): Promise<void> => {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return;

    const exprParts = entries.map(([,], i) => `#k${i} = :v${i}`);
    const values: Record<string, unknown> = {
      ...Object.fromEntries(entries.map(([, v], i) => [`:v${i}`, v])),
      ':now': new Date().toISOString(),
    };
    const names = Object.fromEntries(entries.map(([k], i) => [`#k${i}`, k]));

    if (fields.email) {
      exprParts.push('GSI1PK = :gsiPk', 'GSI1SK = :gsiSk');
      values[':gsiPk'] = `EMAIL#${fields.email}`;
      values[':gsiSk'] = `EMAIL#${fields.email}`;
    }

    await dynamoClient.send(
      new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
        UpdateExpression: `SET ${exprParts.join(', ')}, updatedAt = :now`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
  },
};
