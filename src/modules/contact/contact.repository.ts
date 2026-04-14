import { PutCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import type { IContact, IGroup, IGroupMember } from './contact.types.js';

const USERS_TABLE = 'Zalogram_Users';
const GROUPS_TABLE = 'Zalogram_Groups';

export const contactRepository = {
  getFriends: async (userId: string): Promise<IContact[]> => {
    const pk = `USER#${userId}`;
    console.log('🔍 Querying friends for PK:', pk, 'from table:', USERS_TABLE);
    
    const result = await dynamoClient.send(new QueryCommand({
      TableName: USERS_TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { 
        ':pk': pk,
        ':sk': 'FRIEND#'
      },
    }));
    
    // Filter only confirmed friendships (status='friend')
    const friends = (result.Items as any[] ?? [])
      .filter(item => item.status === 'friend')
      .map(item => ({
        userId: item.PK.substring('USER#'.length),
        friendId: item.SK.substring('FRIEND#'.length),
        status: item.status,
        requestedBy: item.requestedBy,
        createdAt: item.createdAt,
      })) as IContact[];
    
    console.log('✅ Filtered friends (status=friend):', friends);
    
    return friends;
  },

  addFriend: async (contact: IContact): Promise<void> => {
    await dynamoClient.send(new PutCommand({
      TableName: USERS_TABLE,
      Item: {
        PK: `USER#${contact.userId}`,
        SK: `FRIEND#${contact.friendId}`,
        ...contact,
      },
    }));
  },

  removeFriend: async (userId: string, friendId: string): Promise<void> => {
    await dynamoClient.send(new DeleteCommand({
      TableName: USERS_TABLE,
      Key: { PK: `USER#${userId}`, SK: `FRIEND#${friendId}` },
    }));
  },

  getGroups: async (userId: string): Promise<IGroup[]> => {
    // TODO: Query GSI để lấy groups của user
    void userId;
    return [];
  },

  createGroup: async (group: IGroup): Promise<void> => {
    await dynamoClient.send(new PutCommand({
      TableName: GROUPS_TABLE,
      Item: { PK: `GROUP#${group.groupId}`, SK: 'META', ...group },
    }));
  },

  addGroupMember: async (member: IGroupMember): Promise<void> => {
    await dynamoClient.send(new PutCommand({
      TableName: GROUPS_TABLE,
      Item: {
        PK: `GROUP#${member.groupId}`,
        SK: `MEMBER#${member.userId}`,
        ...member,
      },
    }));
  },
};
