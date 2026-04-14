import { GetCommand, UpdateCommand, QueryCommand, BatchGetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import type { IUser, IUpdateProfileDto, IFriendship, IFriendshipResponse } from './user.types.js';

const TABLE_NAME = 'Zalogram_Users';

export const userRepository = {
  findById: async (userId: string): Promise<IUser | null> => {
    const result = await dynamoClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
    }));
    return (result.Item as IUser) ?? null;
  },

  update: async (userId: string, data: IUpdateProfileDto): Promise<IUser> => {
    const entries = Object.entries(data).filter(([, v]) => v !== undefined);
    const updateExpr = entries.map(([, ], i) => `#k${i} = :v${i}`).join(', ');

    const result = await dynamoClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
      UpdateExpression: `SET ${updateExpr}, updatedAt = :now`,
      ExpressionAttributeNames: Object.fromEntries(entries.map(([k], i) => [`#k${i}`, k])),
      ExpressionAttributeValues: {
        ...Object.fromEntries(entries.map(([, v], i) => [`:v${i}`, v])),
        ':now': new Date().toISOString(),
      },
      ReturnValues: 'ALL_NEW',
    }));
    return result.Attributes as IUser;
  },

  search: async (query: string, limit: number = 10, offset: number = 0): Promise<IUser[]> => {
    // Search by displayName or email (case-insensitive) using GSI
    const result = await dynamoClient.send(new QueryCommand({
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
    }));
    return (result.Items as IUser[]) || [];
  },

  findMultipleById: async (userIds: string[]): Promise<IUser[]> => {
    if (userIds.length === 0) return [];

    const keys = userIds.map((userId) => ({
      PK: `USER#${userId}`,
      SK: 'PROFILE',
    }));

    const result = await dynamoClient.send(new BatchGetCommand({
      RequestItems: {
        [TABLE_NAME]: {
          Keys: keys,
        },
      },
    }));

    return (result.Responses?.[TABLE_NAME] as IUser[]) || [];
  },

  findByIds: async (userIds: string[]): Promise<IUser[]> => {
    return userRepository.findMultipleById(userIds);
  },

  // ── Friend Request operations ──
  sendFriendRequest: async (senderId: string, receiverId: string): Promise<void> => {
    const now = new Date().toISOString();
    
    // Store request from sender's side: USER#senderId -> FRIEND_REQUEST_SENT#receiverId
    await dynamoClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `USER#${senderId}`,
        SK: `FRIEND_REQUEST_SENT#${receiverId}`,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      },
    }));

    // Store request from receiver's side: USER#receiverId -> FRIEND_REQUEST_RECEIVED#senderId
    await dynamoClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `USER#${receiverId}`,
        SK: `FRIEND_REQUEST_RECEIVED#${senderId}`,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      },
    }));
  },

  acceptFriendRequest: async (userId: string, senderId: string): Promise<void> => {
    const now = new Date().toISOString();

    // Remove pending request records
    await Promise.all([
      dynamoClient.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${userId}`,
          SK: `FRIEND_REQUEST_RECEIVED#${senderId}`,
        },
      })),
      dynamoClient.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${senderId}`,
          SK: `FRIEND_REQUEST_SENT#${userId}`,
        },
      })),
    ]);

    // Add friend records (bidirectional)
    await Promise.all([
      dynamoClient.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${userId}`,
          SK: `FRIEND#${senderId}`,
          status: 'friend',
          createdAt: now,
          updatedAt: now,
        },
      })),
      dynamoClient.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${senderId}`,
          SK: `FRIEND#${userId}`,
          status: 'friend',
          createdAt: now,
          updatedAt: now,
        },
      })),
    ]);
  },

  rejectFriendRequest: async (userId: string, senderId: string): Promise<void> => {
    // Remove pending request records
    await Promise.all([
      dynamoClient.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${userId}`,
          SK: `FRIEND_REQUEST_RECEIVED#${senderId}`,
        },
      })),
      dynamoClient.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${senderId}`,
          SK: `FRIEND_REQUEST_SENT#${userId}`,
        },
      })),
    ]);
  },

  cancelFriendRequest: async (senderId: string, receiverId: string): Promise<void> => {
    // Remove pending request records
    await Promise.all([
      dynamoClient.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${senderId}`,
          SK: `FRIEND_REQUEST_SENT#${receiverId}`,
        },
      })),
      dynamoClient.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${receiverId}`,
          SK: `FRIEND_REQUEST_RECEIVED#${senderId}`,
        },
      })),
    ]);
  },

  getFriendRequestStatus: async (userId: string, otherUserId: string): Promise<'friend' | 'pending_sent' | 'pending_received' | 'none'> => {
    // Check if friends
    const friendResult = await dynamoClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `USER#${userId}`,
        SK: `FRIEND#${otherUserId}`,
      },
    }));

    if (friendResult.Item) return 'friend';

    // Check if pending sent (userId sent request to otherUserId)
    const sentResult = await dynamoClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `USER#${userId}`,
        SK: `FRIEND_REQUEST_SENT#${otherUserId}`,
      },
    }));

    if (sentResult.Item) return 'pending_sent';

    // Check if pending received (otherUserId sent request to userId)
    const receivedResult = await dynamoClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `USER#${userId}`,
        SK: `FRIEND_REQUEST_RECEIVED#${otherUserId}`,
      },
    }));

    if (receivedResult.Item) return 'pending_received';

    return 'none';
  },

  getPendingRequests: async (userId: string): Promise<{ received: string[]; sent: string[] }> => {
    // Get sent requests
    const sentResult = await dynamoClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': 'FRIEND_REQUEST_SENT#',
      },
    }));

    // Get received requests  
    const receivedResult = await dynamoClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': 'FRIEND_REQUEST_RECEIVED#',
      },
    }));

    const received: string[] = [];
    const sent: string[] = [];

    (sentResult.Items || []).forEach((item: any) => {
      const userId = item.SK.substring('FRIEND_REQUEST_SENT#'.length);
      if (userId) sent.push(userId);
    });

    (receivedResult.Items || []).forEach((item: any) => {
      const userId = item.SK.substring('FRIEND_REQUEST_RECEIVED#'.length);
      if (userId) received.push(userId);
    });

    return { received, sent };
  },

  getFriendIds: async (userId: string, limit: number = 100, offset: number = 0): Promise<string[]> => {
    const result = await dynamoClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': 'FRIEND#',
      },
      Limit: limit,
    }));

    console.log('getFriendIds query result for user:', userId, 'Items count:', result.Items?.length || 0);
    console.log('getFriendIds raw items:', result.Items);
    
    const friendIds: string[] = [];
    (result.Items || []).forEach((item: any) => {
      console.log('Processing friend item - SK:', item.SK, 'status:', item.status);
      // Only include items with status='friend' to ensure only confirmed friendships
      if (item.SK.startsWith('FRIEND#') && item.status === 'friend') {
        const fId = item.SK.substring('FRIEND#'.length);
        if (fId) {
          console.log('Added friend ID:', fId);
          friendIds.push(fId);
        }
      }
    });
    
    console.log('Final friendIds for user', userId, ':', friendIds);
    return friendIds;
  },

  checkFriendship: async (userId: string, friendId: string): Promise<boolean> => {
    const result = await dynamoClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `USER#${userId}`,
        SK: `FRIEND#${friendId}`,
      },
    }));
    
    const isFriend = !!result.Item && result.Item.status === 'friend';
    return isFriend;
  },

  removeFriend: async (userId: string, friendId: string): Promise<void> => {
    // Remove friend record from both sides (bidirectional)
    await Promise.all([
      dynamoClient.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${userId}`,
          SK: `FRIEND#${friendId}`,
        },
      })),
      dynamoClient.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${friendId}`,
          SK: `FRIEND#${userId}`,
        },
      })),
    ]);
    console.log(`Friendship removed between ${userId} and ${friendId}`);
  },
};
