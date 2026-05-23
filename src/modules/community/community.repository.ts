import {
  BatchGetCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
  type QueryCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import { env } from '@/config/env.js';
import type {
  CommunityContentType,
  CommunityMemberRole,
  ICommunity,
  ICommunityContentIndex,
  ICommunityJoinRequest,
  ICommunityMember,
  ICommunityPendingRequest,
  ICommunityModerationLog,
} from './community.types.js';

const GROUPS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Groups`;
const MODERATION_LOGS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}ModerationLogs`;
const GSI1 = 'GSI-1';
const GSI2 = 'GSI-2';

export const padMs = (value: number): string => value.toString().padStart(13, '0');

type PageResult<T> = {
  items: T[];
  lastEvaluatedKey?: Record<string, unknown>;
};

const isMissingKeySchemaError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  'message' in error &&
  String((error as { name?: string }).name) === 'ValidationException' &&
  String((error as { message?: string }).message).includes(
    'Query condition missed key schema element',
  );

export const communityRepository = {
  getCommunityById: async (groupId: string): Promise<ICommunity | null> => {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: GROUPS_TABLE,
        Key: { PK: `GROUP#${groupId}`, SK: 'META' },
      }),
    );
    return (result.Item as ICommunity | undefined) ?? null;
  },

  getSlugLookup: async (slug: string): Promise<{ groupId: string } | null> => {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: GROUPS_TABLE,
        Key: { PK: `SLUG#${slug}`, SK: 'GROUP' },
      }),
    );
    return (result.Item as { groupId: string } | undefined) ?? null;
  },

  getMember: async (groupId: string, userId: string): Promise<ICommunityMember | null> => {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: GROUPS_TABLE,
        Key: { PK: `GROUP#${groupId}`, SK: `MEMBER#${userId}` },
      }),
    );
    return (result.Item as ICommunityMember | undefined) ?? null;
  },

  getJoinRequest: async (
    groupId: string,
    userId: string,
  ): Promise<ICommunityJoinRequest | null> => {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: GROUPS_TABLE,
        Key: { PK: `GROUP#${groupId}`, SK: `REQUEST#${userId}` },
      }),
    );
    return (result.Item as ICommunityJoinRequest | undefined) ?? null;
  },

  createCommunity: async (community: ICommunity, ownerMember: ICommunityMember): Promise<void> => {
    await dynamoClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: GROUPS_TABLE,
              Item: {
                PK: `GROUP#${community.groupId}`,
                SK: 'META',
                GSI2PK: `CATEGORY#${community.category}`,
                GSI2SK: `POPULAR#0000000000#${community.groupId}`,
                ...community,
              },
              ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
            },
          },
          {
            Put: {
              TableName: GROUPS_TABLE,
              Item: {
                PK: `SLUG#${community.slug}`,
                SK: 'GROUP',
                slug: community.slug,
                groupId: community.groupId,
                communityId: community.communityId,
                createdAt: community.createdAt,
              },
              ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
            },
          },
          {
            Put: {
              TableName: GROUPS_TABLE,
              Item: {
                PK: `GROUP#${community.groupId}`,
                SK: `MEMBER#${ownerMember.userId}`,
                ...ownerMember,
              },
              ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
            },
          },
        ],
      }),
    );
  },

  updateCommunity: async (
    groupId: string,
    updates: Partial<ICommunity>,
    previousSlug?: string,
    nextSlug?: string,
  ): Promise<ICommunity> => {
    const entries = Object.entries(updates).filter(([, value]) => value !== undefined);
    const setExpr = entries.map(([key], index) => `#k${index} = :v${index}`).join(', ');
    const expressionNames = Object.fromEntries(entries.map(([key], index) => [`#k${index}`, key]));
    const expressionValues = Object.fromEntries(
      entries.map(([, value], index) => [`:v${index}`, value]),
    );

    const transactItems = [];
    if (nextSlug && nextSlug !== previousSlug) {
      transactItems.push({
        Put: {
          TableName: GROUPS_TABLE,
          Item: {
            PK: `SLUG#${nextSlug}`,
            SK: 'GROUP',
            slug: nextSlug,
            groupId,
            communityId: groupId,
            createdAt: new Date().toISOString(),
          },
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        },
      });
    }

    transactItems.push({
      Update: {
        TableName: GROUPS_TABLE,
        Key: { PK: `GROUP#${groupId}`, SK: 'META' },
        UpdateExpression: `SET ${setExpr}`,
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: expressionValues,
        ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
      },
    });

    await dynamoClient.send(new TransactWriteCommand({ TransactItems: transactItems }));
    const updated = await communityRepository.getCommunityById(groupId);
    if (!updated) throw new Error('Community update failed');
    return updated;
  },

  listByCategory: async (
    category: string,
    limit: number,
    exclusiveStartKey?: Record<string, unknown>,
  ): Promise<PageResult<ICommunity>> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: GROUPS_TABLE,
        IndexName: GSI2,
        KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :prefix)',
        FilterExpression: 'isActive = :active AND #status = :status AND #type = :type',
        ExpressionAttributeNames: { '#status': 'status', '#type': 'type' },
        ExpressionAttributeValues: {
          ':pk': `CATEGORY#${category}`,
          ':prefix': 'POPULAR#',
          ':active': true,
          ':status': 'active',
          ':type': 'public',
        },
        Limit: limit,
        ScanIndexForward: false,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    return {
      items: (result.Items as ICommunity[]) ?? [],
      lastEvaluatedKey: result.LastEvaluatedKey as Record<string, unknown> | undefined,
    };
  },

  listAll: async (
    limit: number,
    exclusiveStartKey?: Record<string, unknown>,
  ): Promise<PageResult<ICommunity>> => {
    const result = await dynamoClient.send(
      new ScanCommand({
        TableName: GROUPS_TABLE,
        FilterExpression: 'SK = :sk AND isActive = :active AND #status = :status AND #type = :type',
        ExpressionAttributeNames: { '#status': 'status', '#type': 'type' },
        ExpressionAttributeValues: {
          ':sk': 'META',
          ':active': true,
          ':status': 'active',
          ':type': 'public',
        },
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    return {
      items: (result.Items as ICommunity[]) ?? [],
      lastEvaluatedKey: result.LastEvaluatedKey as Record<string, unknown> | undefined,
    };
  },

  listJoinedByUser: async (
    userId: string,
    limit: number,
    exclusiveStartKey?: Record<string, unknown>,
  ): Promise<PageResult<ICommunityMember>> => {
    let result: QueryCommandOutput;
    try {
      result = await dynamoClient.send(
        new QueryCommand({
          TableName: GROUPS_TABLE,
          IndexName: GSI1,
          KeyConditionExpression: 'userId = :userId',
          ExpressionAttributeValues: { ':userId': userId },
          Limit: limit,
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
    } catch (error) {
      if (!isMissingKeySchemaError(error)) throw error;
      result = await dynamoClient.send(
        new QueryCommand({
          TableName: GROUPS_TABLE,
          IndexName: GSI1,
          KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
          ExpressionAttributeValues: {
            ':pk': `USER#${userId}`,
            ':prefix': 'JOINED#',
          },
          Limit: limit,
          ScanIndexForward: false,
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
    }
    return {
      items: ((result.Items as ICommunityMember[]) ?? []).filter(
        (item) => item.status === 'active',
      ),
      lastEvaluatedKey: result.LastEvaluatedKey as Record<string, unknown> | undefined,
    };
  },

  batchGetCommunities: async (groupIds: string[]): Promise<ICommunity[]> => {
    if (groupIds.length === 0) return [];
    const result = await dynamoClient.send(
      new BatchGetCommand({
        RequestItems: {
          [GROUPS_TABLE]: {
            Keys: groupIds.map((groupId) => ({ PK: `GROUP#${groupId}`, SK: 'META' })),
          },
        },
      }),
    );
    return (result.Responses?.[GROUPS_TABLE] as ICommunity[]) ?? [];
  },

  listMembers: async (groupId: string): Promise<ICommunityMember[]> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: GROUPS_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `GROUP#${groupId}`, ':prefix': 'MEMBER#' },
      }),
    );
    return ((result.Items as ICommunityMember[]) ?? []).filter((item) => item.status === 'active');
  },

  putOpenMember: async (member: ICommunityMember): Promise<void> => {
    await dynamoClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: GROUPS_TABLE,
              Item: { PK: `GROUP#${member.groupId}`, SK: `MEMBER#${member.userId}`, ...member },
              ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
            },
          },
          {
            Update: {
              TableName: GROUPS_TABLE,
              Key: { PK: `GROUP#${member.groupId}`, SK: 'META' },
              UpdateExpression: 'SET updatedAt = :now ADD memberCount :one',
              ExpressionAttributeValues: { ':one': 1, ':now': new Date().toISOString() },
            },
          },
        ],
      }),
    );
  },

  createJoinRequest: async (
    request: ICommunityJoinRequest,
    pending: ICommunityPendingRequest,
  ): Promise<void> => {
    await dynamoClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: GROUPS_TABLE,
              Item: { PK: `GROUP#${request.groupId}`, SK: `REQUEST#${request.userId}`, ...request },
              ConditionExpression: 'attribute_not_exists(PK) OR #status <> :pending',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: { ':pending': 'pending' },
            },
          },
          {
            Put: {
              TableName: GROUPS_TABLE,
              Item: {
                PK: `GROUP#${pending.groupId}`,
                SK: `REQUEST_PENDING#${padMs(pending.requestedAtMs)}#${pending.userId}`,
                ...pending,
              },
            },
          },
        ],
      }),
    );
  },

  listPendingRequests: async (groupId: string): Promise<ICommunityPendingRequest[]> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: GROUPS_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `GROUP#${groupId}`,
          ':prefix': 'REQUEST_PENDING#',
        },
        ScanIndexForward: true,
      }),
    );
    return (result.Items as ICommunityPendingRequest[]) ?? [];
  },

  approveJoinRequest: async (
    request: ICommunityJoinRequest,
    member: ICommunityMember,
    resolverId: string,
  ): Promise<void> => {
    await dynamoClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: GROUPS_TABLE,
              Item: { PK: `GROUP#${member.groupId}`, SK: `MEMBER#${member.userId}`, ...member },
              ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
            },
          },
          {
            Update: {
              TableName: GROUPS_TABLE,
              Key: { PK: `GROUP#${request.groupId}`, SK: `REQUEST#${request.userId}` },
              UpdateExpression: 'SET #status = :approved, resolvedAt = :now, resolvedBy = :by',
              ConditionExpression: '#status = :pending',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':approved': 'approved',
                ':pending': 'pending',
                ':now': new Date().toISOString(),
                ':by': resolverId,
              },
            },
          },
          {
            Delete: {
              TableName: GROUPS_TABLE,
              Key: {
                PK: `GROUP#${request.groupId}`,
                SK: `REQUEST_PENDING#${padMs(request.requestedAtMs)}#${request.userId}`,
              },
            },
          },
          {
            Update: {
              TableName: GROUPS_TABLE,
              Key: { PK: `GROUP#${request.groupId}`, SK: 'META' },
              UpdateExpression: 'SET updatedAt = :now ADD memberCount :one',
              ExpressionAttributeValues: { ':one': 1, ':now': new Date().toISOString() },
            },
          },
        ],
      }),
    );
  },

  rejectJoinRequest: async (request: ICommunityJoinRequest, resolverId: string): Promise<void> => {
    await dynamoClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: GROUPS_TABLE,
              Key: { PK: `GROUP#${request.groupId}`, SK: `REQUEST#${request.userId}` },
              UpdateExpression: 'SET #status = :rejected, resolvedAt = :now, resolvedBy = :by',
              ConditionExpression: '#status = :pending',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':rejected': 'rejected',
                ':pending': 'pending',
                ':now': new Date().toISOString(),
                ':by': resolverId,
              },
            },
          },
          {
            Delete: {
              TableName: GROUPS_TABLE,
              Key: {
                PK: `GROUP#${request.groupId}`,
                SK: `REQUEST_PENDING#${padMs(request.requestedAtMs)}#${request.userId}`,
              },
            },
          },
        ],
      }),
    );
  },

  archiveCommunity: async (groupId: string, actorId: string): Promise<void> => {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: GROUPS_TABLE,
        Key: { PK: `GROUP#${groupId}`, SK: 'META' },
        UpdateExpression:
          'SET isActive = :inactive, #status = :archived, deletedAt = :now, deletedBy = :by, updatedAt = :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':inactive': false,
          ':archived': 'archived',
          ':now': new Date().toISOString(),
          ':by': actorId,
        },
      }),
    );
  },

  leaveCommunity: async (groupId: string, userId: string): Promise<void> => {
    await dynamoClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              TableName: GROUPS_TABLE,
              Key: { PK: `GROUP#${groupId}`, SK: `MEMBER#${userId}` },
            },
          },
          {
            Update: {
              TableName: GROUPS_TABLE,
              Key: { PK: `GROUP#${groupId}`, SK: 'META' },
              UpdateExpression: 'SET updatedAt = :now ADD memberCount :minusOne',
              ExpressionAttributeValues: { ':minusOne': -1, ':now': new Date().toISOString() },
            },
          },
        ],
      }),
    );
  },

  banMember: async (groupId: string, userId: string): Promise<void> => {
    await dynamoClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: GROUPS_TABLE,
              Key: { PK: `GROUP#${groupId}`, SK: `MEMBER#${userId}` },
              UpdateExpression: 'SET #status = :banned REMOVE GSI1PK, GSI1SK',
              ConditionExpression: '#status = :active',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: { ':banned': 'banned', ':active': 'active' },
            },
          },
          {
            Update: {
              TableName: GROUPS_TABLE,
              Key: { PK: `GROUP#${groupId}`, SK: 'META' },
              UpdateExpression: 'SET updatedAt = :now ADD memberCount :minusOne',
              ExpressionAttributeValues: { ':minusOne': -1, ':now': new Date().toISOString() },
            },
          },
        ],
      }),
    );
  },

  updateMemberRole: async (
    groupId: string,
    userId: string,
    role: Exclude<CommunityMemberRole, 'owner'>,
  ): Promise<void> => {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: GROUPS_TABLE,
        Key: { PK: `GROUP#${groupId}`, SK: `MEMBER#${userId}` },
        UpdateExpression: 'SET #role = :role',
        ExpressionAttributeNames: { '#role': 'role' },
        ExpressionAttributeValues: { ':role': role },
      }),
    );
  },

  transferOwner: async (
    groupId: string,
    currentOwnerId: string,
    targetUserId: string,
  ): Promise<void> => {
    await dynamoClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: GROUPS_TABLE,
              Key: { PK: `GROUP#${groupId}`, SK: `MEMBER#${targetUserId}` },
              UpdateExpression: 'SET #role = :owner',
              ConditionExpression: '#status = :active',
              ExpressionAttributeNames: { '#role': 'role', '#status': 'status' },
              ExpressionAttributeValues: { ':owner': 'owner', ':active': 'active' },
            },
          },
          {
            Update: {
              TableName: GROUPS_TABLE,
              Key: { PK: `GROUP#${groupId}`, SK: `MEMBER#${currentOwnerId}` },
              UpdateExpression: 'SET #role = :admin',
              ExpressionAttributeNames: { '#role': 'role' },
              ExpressionAttributeValues: { ':admin': 'admin' },
            },
          },
          {
            Update: {
              TableName: GROUPS_TABLE,
              Key: { PK: `GROUP#${groupId}`, SK: 'META' },
              UpdateExpression: 'SET ownerId = :ownerId, updatedAt = :now',
              ExpressionAttributeValues: {
                ':ownerId': targetUserId,
                ':now': new Date().toISOString(),
              },
            },
          },
        ],
      }),
    );
  },

  addContentIndex: async (content: ICommunityContentIndex): Promise<void> => {
    await dynamoClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: GROUPS_TABLE,
              Item: {
                PK: `GROUP#${content.groupId}`,
                SK: `CONTENT#${padMs(content.createdAtMs)}#${content.contentType}#${content.contentId}`,
                ...content,
              },
              ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
            },
          },
          {
            Update: {
              TableName: GROUPS_TABLE,
              Key: { PK: `GROUP#${content.groupId}`, SK: 'META' },
              UpdateExpression: 'SET updatedAt = :now ADD postCount :one',
              ExpressionAttributeValues: { ':one': 1, ':now': new Date().toISOString() },
            },
          },
        ],
      }),
    );
  },

  addPendingContentIndex: async (content: ICommunityContentIndex): Promise<void> => {
    await dynamoClient.send(
      new PutCommand({
        TableName: GROUPS_TABLE,
        Item: {
          PK: `GROUP#${content.groupId}`,
          SK: `PENDING_CONTENT#${padMs(content.createdAtMs)}#${content.contentType}#${content.contentId}`,
          ...content,
        },
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      }),
    );
  },

  deletePendingContentIndex: async (
    groupId: string,
    contentType: CommunityContentType,
    contentId: string,
    createdAtMs: number,
  ): Promise<void> => {
    await dynamoClient.send(
      new DeleteCommand({
        TableName: GROUPS_TABLE,
        Key: {
          PK: `GROUP#${groupId}`,
          SK: `PENDING_CONTENT#${padMs(createdAtMs)}#${contentType}#${contentId}`,
        },
      }),
    );
  },

  listPendingContentIndex: async (
    groupId: string,
    contentType: CommunityContentType,
    limit: number,
    exclusiveStartKey?: Record<string, unknown>,
  ): Promise<PageResult<ICommunityContentIndex>> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: GROUPS_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `GROUP#${groupId}`,
          ':prefix': 'PENDING_CONTENT#',
        },
        Limit: limit,
        ScanIndexForward: false,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    const items = ((result.Items as ICommunityContentIndex[]) ?? []).filter(
      (item) => item.contentType === contentType,
    );
    return {
      items,
      lastEvaluatedKey: result.LastEvaluatedKey as Record<string, unknown> | undefined,
    };
  },

  listContentIndex: async (
    groupId: string,
    contentType: CommunityContentType,
    limit: number,
    exclusiveStartKey?: Record<string, unknown>,
  ): Promise<PageResult<ICommunityContentIndex>> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: GROUPS_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `GROUP#${groupId}`,
          ':prefix': 'CONTENT#',
        },
        Limit: limit,
        ScanIndexForward: false,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    const items = ((result.Items as ICommunityContentIndex[]) ?? []).filter(
      (item) => item.contentType === contentType,
    );
    return {
      items,
      lastEvaluatedKey: result.LastEvaluatedKey as Record<string, unknown> | undefined,
    };
  },

  createModerationLog: async (log: ICommunityModerationLog): Promise<void> => {
    await dynamoClient.send(
      new PutCommand({
        TableName: MODERATION_LOGS_TABLE,
        Item: {
          PK: `GROUP#${log.groupId}`,
          SK: `LOG#${padMs(log.createdAtMs)}#${log.logId}`,
          ...log,
        },
      }),
    );
  },

  listModerationLogs: async (
    groupId: string,
    limit: number,
    exclusiveStartKey?: Record<string, unknown>,
  ): Promise<PageResult<ICommunityModerationLog>> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: MODERATION_LOGS_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `GROUP#${groupId}`,
          ':prefix': 'LOG#',
        },
        Limit: limit,
        ScanIndexForward: false, // Lấy mới nhất lên đầu tiên
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    return {
      items: (result.Items as ICommunityModerationLog[]) ?? [],
      lastEvaluatedKey: result.LastEvaluatedKey as Record<string, unknown> | undefined,
    };
  },

  deleteContentIndex: async (
    groupId: string,
    contentType: CommunityContentType,
    contentId: string,
    createdAtMs: number,
  ): Promise<void> => {
    await dynamoClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              TableName: GROUPS_TABLE,
              Key: {
                PK: `GROUP#${groupId}`,
                SK: `CONTENT#${padMs(createdAtMs)}#${contentType}#${contentId}`,
              },
            },
          },
          {
            Update: {
              TableName: GROUPS_TABLE,
              Key: { PK: `GROUP#${groupId}`, SK: 'META' },
              UpdateExpression: 'SET updatedAt = :now ADD postCount :minusOne',
              ExpressionAttributeValues: {
                ':minusOne': -1,
                ':now': new Date().toISOString(),
              },
            },
          },
        ],
      }),
    );
  },

  updateConversationId: async (
    groupId: string,
    conversationId: string | null,
    chatEnabled: boolean,
  ): Promise<void> => {
    if (conversationId) {
      await dynamoClient.send(
        new UpdateCommand({
          TableName: GROUPS_TABLE,
          Key: { PK: `GROUP#${groupId}`, SK: 'META' },
          UpdateExpression:
            'SET conversationId = :conversationId, chatEnabled = :chatEnabled, updatedAt = :now',
          ExpressionAttributeValues: {
            ':conversationId': conversationId,
            ':chatEnabled': chatEnabled,
            ':now': new Date().toISOString(),
          },
        }),
      );
    } else {
      await dynamoClient.send(
        new UpdateCommand({
          TableName: GROUPS_TABLE,
          Key: { PK: `GROUP#${groupId}`, SK: 'META' },
          UpdateExpression:
            'REMOVE conversationId SET chatEnabled = :chatEnabled, updatedAt = :now',
          ExpressionAttributeValues: {
            ':chatEnabled': chatEnabled,
            ':now': new Date().toISOString(),
          },
        }),
      );
    }
  },
};
