import { PutCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import type { IContact, IGroup, IGroupMember } from './contact.types.js';

const CONTACTS_TABLE = 'Zalogram_Contacts';
const GROUPS_TABLE = 'Zalogram_Groups';

export const contactRepository = {
  getFriends: async (userId: string): Promise<IContact[]> => {
    const result = await dynamoClient.send(new QueryCommand({
      TableName: CONTACTS_TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `USER#${userId}` },
    }));
    return (result.Items as IContact[]) ?? [];
  },

  addFriend: async (contact: IContact): Promise<void> => {
    await dynamoClient.send(new PutCommand({
      TableName: CONTACTS_TABLE,
      Item: {
        PK: `USER#${contact.userId}`,
        SK: `FRIEND#${contact.friendId}`,
        ...contact,
      },
    }));
  },

  removeFriend: async (userId: string, friendId: string): Promise<void> => {
    await dynamoClient.send(new DeleteCommand({
      TableName: CONTACTS_TABLE,
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
