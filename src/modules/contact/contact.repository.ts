import { PutCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import { env } from '@/config/env.js';
import type { IContact, IGroup, IGroupMember } from './contact.types.js';

const USERS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Users`;
const GROUPS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Groups`;
type FriendRelationRecord = {
  PK: string;
  SK: string;
  status?: string;
  requestedBy?: string;
  createdAt?: string;
};

export const contactRepository = {
  getFriends: async (userId: string): Promise<IContact[]> => {
    const pk = `USER#${userId}`;

    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: USERS_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': pk,
          ':sk': 'FRIEND#',
        },
      }),
    );

    // Filter only confirmed friendships (status='friend')
    const friends = ((result.Items as FriendRelationRecord[] | undefined) ?? [])
      .filter((item) => item?.status === 'friend' || item?.status === 'accepted')
      .map((item) => ({
        userId: item.PK.substring('USER#'.length),
        friendId: item.SK.substring('FRIEND#'.length),
        status: (item.status ?? 'accepted') as IContact['status'],
        requestedBy: item.requestedBy ?? '',
        createdAt: item.createdAt ?? new Date(0).toISOString(),
      })) as IContact[];

    return friends;
  },

  removeFriend: async (userId: string, friendId: string): Promise<void> => {
    await dynamoClient.send(
      new DeleteCommand({
        TableName: USERS_TABLE,
        Key: { PK: `USER#${userId}`, SK: `FRIEND#${friendId}` },
      }),
    );
  },

  getGroups: (userId: string): Promise<IGroup[]> => {
    // TODO: Query GSI để lấy groups của user
    void userId;
    return Promise.resolve([]);
  },

  createGroup: async (group: IGroup): Promise<void> => {
    await dynamoClient.send(
      new PutCommand({
        TableName: GROUPS_TABLE,
        Item: { PK: `GROUP#${group.groupId}`, SK: 'META', ...group },
      }),
    );
  },

  addGroupMember: async (member: IGroupMember): Promise<void> => {
    await dynamoClient.send(
      new PutCommand({
        TableName: GROUPS_TABLE,
        Item: {
          PK: `GROUP#${member.groupId}`,
          SK: `MEMBER#${member.userId}`,
          ...member,
        },
      }),
    );
  },
};
