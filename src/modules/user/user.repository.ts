import {
  GetCommand,
  UpdateCommand,
  QueryCommand,
  BatchGetCommand,
  PutCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import { env } from '@/config/env.js';
import type { IUser, IUpdateProfileDto } from './user.types.js';

const TABLE_NAME = `${env.DYNAMODB_TABLE_PREFIX}Users`;
type UserRelationRecord = {
  SK: string;
  status?: string;
};

export const userRepository = {
  findById: async (userId: string): Promise<IUser | null> => {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
        ConsistentRead: true,
      }),
    );
    const item = result.Item as IUser | undefined;
    if (item && !item.userId && (item as any).PK) {
      item.userId = (item as any).PK.replace('USER#', '');
    }
    return item ?? null;
  },

  update: async (userId: string, data: IUpdateProfileDto): Promise<IUser> => {
    const entries = Object.entries(data).filter(([, v]) => v !== undefined);
    const updateExpr = entries.map(([,], i) => `#k${i} = :v${i}`).join(', ');

    const result = await dynamoClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
        UpdateExpression: `SET ${updateExpr}, updatedAt = :now`,
        ExpressionAttributeNames: Object.fromEntries(entries.map(([k], i) => [`#k${i}`, k])),
        ExpressionAttributeValues: {
          ...Object.fromEntries(entries.map(([, v], i) => [`:v${i}`, v])),
          ':now': new Date().toISOString(),
        },
        ReturnValues: 'ALL_NEW',
      }),
    );
    return result.Attributes as IUser;
  },

  search: async (query: string, limit: number = 10, offset: number = 0): Promise<IUser[]> => {
    // Search by displayName or email (case-insensitive) using GSI
    void offset;
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'GSI-1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': 'SEARCH',
          ':sk': query.toLowerCase(),
        },
        Limit: limit,
        ExclusiveStartKey: offset > 0 ? { offset } : undefined,
        ScanIndexForward: true,
      }),
    );
    return (result.Items as IUser[]) || [];
  },

  findMultipleById: async (userIds: string[]): Promise<IUser[]> => {
    if (userIds.length === 0) return [];

    const keys = userIds.map((userId) => ({
      PK: `USER#${userId}`,
      SK: 'PROFILE',
    }));

    const result = await dynamoClient.send(
      new BatchGetCommand({
        RequestItems: {
          [TABLE_NAME]: {
            Keys: keys,
            ConsistentRead: true,
          },
        },
      }),
    );

    const items = (result.Responses?.[TABLE_NAME] as IUser[]) || [];
    return items.map((item: any) => {
      if (!item.userId && item.PK) {
        item.userId = item.PK.replace('USER#', '');
      }
      return item;
    });
  },

  findByIds: async (userIds: string[]): Promise<IUser[]> => {
    return userRepository.findMultipleById(userIds);
  },

  // ── Friend Request operations ──
  sendFriendRequest: async (senderId: string, receiverId: string): Promise<void> => {
    const now = new Date().toISOString();

    // Store request from sender's side: USER#senderId -> FRIEND_REQUEST_SENT#receiverId
    await dynamoClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${senderId}`,
          SK: `FRIEND_REQUEST_SENT#${receiverId}`,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    // Store request from receiver's side: USER#receiverId -> FRIEND_REQUEST_RECEIVED#senderId
    await dynamoClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${receiverId}`,
          SK: `FRIEND_REQUEST_RECEIVED#${senderId}`,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
  },

  acceptFriendRequest: async (userId: string, senderId: string): Promise<void> => {
    const now = new Date().toISOString();

    // Remove pending request records
    await Promise.all([
      dynamoClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: {
            PK: `USER#${userId}`,
            SK: `FRIEND_REQUEST_RECEIVED#${senderId}`,
          },
        }),
      ),
      dynamoClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: {
            PK: `USER#${senderId}`,
            SK: `FRIEND_REQUEST_SENT#${userId}`,
          },
        }),
      ),
    ]);

    // Add friend records (bidirectional)
    await Promise.all([
      dynamoClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: `USER#${userId}`,
            SK: `FRIEND#${senderId}`,
            status: 'friend',
            createdAt: now,
            updatedAt: now,
          },
        }),
      ),
      dynamoClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: `USER#${senderId}`,
            SK: `FRIEND#${userId}`,
            status: 'friend',
            createdAt: now,
            updatedAt: now,
          },
        }),
      ),
    ]);
  },

  rejectFriendRequest: async (userId: string, senderId: string): Promise<void> => {
    // Remove pending request records
    await Promise.all([
      dynamoClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: {
            PK: `USER#${userId}`,
            SK: `FRIEND_REQUEST_RECEIVED#${senderId}`,
          },
        }),
      ),
      dynamoClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: {
            PK: `USER#${senderId}`,
            SK: `FRIEND_REQUEST_SENT#${userId}`,
          },
        }),
      ),
    ]);
  },

  cancelFriendRequest: async (senderId: string, receiverId: string): Promise<void> => {
    // Remove pending request records
    await Promise.all([
      dynamoClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: {
            PK: `USER#${senderId}`,
            SK: `FRIEND_REQUEST_SENT#${receiverId}`,
          },
        }),
      ),
      dynamoClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: {
            PK: `USER#${receiverId}`,
            SK: `FRIEND_REQUEST_RECEIVED#${senderId}`,
          },
        }),
      ),
    ]);
  },

  getFriendRequestStatus: async (
    userId: string,
    otherUserId: string,
  ): Promise<'friend' | 'pending_sent' | 'pending_received' | 'blocked' | 'none'> => {
    // Check if friends
    const friendResult = await dynamoClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${userId}`,
          SK: `FRIEND#${otherUserId}`,
        },
      }),
    );

    const [blockedByMeResult, blockedByOtherResult] = await Promise.all([
      dynamoClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: {
            PK: `USER#${userId}`,
            SK: `BLOCK#${otherUserId}`,
          },
        }),
      ),
      dynamoClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: {
            PK: `USER#${otherUserId}`,
            SK: `BLOCK#${userId}`,
          },
        }),
      ),
    ]);

    if (
      (friendResult.Item as { status?: string } | undefined)?.status === 'blocked' ||
      blockedByMeResult.Item ||
      (blockedByOtherResult.Item as { status?: string } | undefined)?.status === 'blocked' ||
      blockedByOtherResult.Item
    ) {
      return 'blocked';
    }

    if (friendResult.Item) return 'friend';

    // Check if pending sent (userId sent request to otherUserId)
    const sentResult = await dynamoClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${userId}`,
          SK: `FRIEND_REQUEST_SENT#${otherUserId}`,
        },
      }),
    );

    if (sentResult.Item) return 'pending_sent';

    // Check if pending received (otherUserId sent request to userId)
    const receivedResult = await dynamoClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${userId}`,
          SK: `FRIEND_REQUEST_RECEIVED#${otherUserId}`,
        },
      }),
    );

    if (receivedResult.Item) return 'pending_received';

    return 'none';
  },

  getPendingRequests: async (userId: string): Promise<{ received: string[]; sent: string[] }> => {
    // Get sent requests
    const sentResult = await dynamoClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':sk': 'FRIEND_REQUEST_SENT#',
        },
      }),
    );

    // Get received requests
    const receivedResult = await dynamoClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':sk': 'FRIEND_REQUEST_RECEIVED#',
        },
      }),
    );

    const received: string[] = [];
    const sent: string[] = [];

    const sentItems = (sentResult.Items as UserRelationRecord[] | undefined) ?? [];
    sentItems.forEach((item) => {
      const userId = item.SK.substring('FRIEND_REQUEST_SENT#'.length);
      if (userId) sent.push(userId);
    });

    const receivedItems = (receivedResult.Items as UserRelationRecord[] | undefined) ?? [];
    receivedItems.forEach((item) => {
      const userId = item.SK.substring('FRIEND_REQUEST_RECEIVED#'.length);
      if (userId) received.push(userId);
    });

    return { received, sent };
  },

  getFriendIds: async (
    userId: string,
    limit: number = 100,
    offset: number = 0,
  ): Promise<string[]> => {
    void offset;
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':sk': 'FRIEND#',
        },
        Limit: limit,
      }),
    );

    const friendIds: string[] = [];
    const relationItems = (result.Items as UserRelationRecord[] | undefined) ?? [];
    relationItems.forEach((item) => {
      // Only include items with status='friend' to ensure only confirmed friendships
      if (item.SK.startsWith('FRIEND#') && item.status === 'friend') {
        const fId = item.SK.substring('FRIEND#'.length);
        if (fId) {
          friendIds.push(fId);
        }
      }
    });
    return friendIds;
  },

  checkFriendship: async (userId: string, friendId: string): Promise<boolean> => {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${userId}`,
          SK: `FRIEND#${friendId}`,
        },
      }),
    );

    const relation = result.Item as { status?: string } | undefined;
    const isFriend = relation?.status === 'friend';
    return isFriend;
  },

  removeFriend: async (userId: string, friendId: string): Promise<void> => {
    // Remove friend record from both sides (bidirectional)
    await Promise.all([
      dynamoClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: {
            PK: `USER#${userId}`,
            SK: `FRIEND#${friendId}`,
          },
        }),
      ),
      dynamoClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: {
            PK: `USER#${friendId}`,
            SK: `FRIEND#${userId}`,
          },
        }),
      ),
    ]);
  },

  blockFriend: async (userId: string, friendId: string): Promise<void> => {
    const now = new Date().toISOString();

    await Promise.all([
      dynamoClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { PK: `USER#${userId}`, SK: `FRIEND_REQUEST_SENT#${friendId}` },
        }),
      ),
      dynamoClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { PK: `USER#${friendId}`, SK: `FRIEND_REQUEST_RECEIVED#${userId}` },
        }),
      ),
      dynamoClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { PK: `USER#${userId}`, SK: `FRIEND_REQUEST_RECEIVED#${friendId}` },
        }),
      ),
      dynamoClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { PK: `USER#${friendId}`, SK: `FRIEND_REQUEST_SENT#${userId}` },
        }),
      ),
      dynamoClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: `USER#${userId}`,
            SK: `BLOCK#${friendId}`,
            status: 'blocked',
            createdAt: now,
            updatedAt: now,
          },
        }),
      ),
    ]);
  },

  unblockFriend: async (userId: string, friendId: string): Promise<void> => {
    await Promise.all([
      dynamoClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { PK: `USER#${userId}`, SK: `BLOCK#${friendId}` },
        }),
      ),
      dynamoClient
        .send(
          new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { PK: `USER#${userId}`, SK: `FRIEND#${friendId}` },
            ConditionExpression: '#status = :blocked',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':blocked': 'blocked' },
          }),
        )
        .catch(() => undefined),
    ]);
  },

  getBlockStatusBetween: async (
    userId: string,
    otherUserId: string,
  ): Promise<'blocked_by_me' | 'blocked_by_other' | 'none'> => {
    const [aBlocksB, bBlocksA, legacyABlocksB, legacyBBlocksA] = await Promise.all([
      dynamoClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: `USER#${userId}`, SK: `BLOCK#${otherUserId}` },
        }),
      ),
      dynamoClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: `USER#${otherUserId}`, SK: `BLOCK#${userId}` },
        }),
      ),
      dynamoClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: `USER#${userId}`, SK: `FRIEND#${otherUserId}` },
        }),
      ),
      dynamoClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: `USER#${otherUserId}`, SK: `FRIEND#${userId}` },
        }),
      ),
    ]);

    if (
      aBlocksB.Item ||
      (legacyABlocksB.Item as { status?: string } | undefined)?.status === 'blocked'
    ) {
      return 'blocked_by_me';
    }
    if (
      bBlocksA.Item ||
      (legacyBBlocksA.Item as { status?: string } | undefined)?.status === 'blocked'
    ) {
      return 'blocked_by_other';
    }
    return 'none';
  },

  hasBlockBetween: async (userAId: string, userBId: string): Promise<boolean> => {
    return (await userRepository.getBlockStatusBetween(userAId, userBId)) !== 'none';
  },
};
