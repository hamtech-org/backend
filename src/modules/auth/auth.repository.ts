import {
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  UpdateCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import type { ISession } from './auth.types.js';
import type { IUser } from '@/modules/user/user.types.js';

const USERS_TABLE = 'Zalogram_Users';
const SESSIONS_TABLE = 'Zalogram_Sessions';

export const authRepository = {
  // ──────────────────────────────────────────────
  // USER operations
  // ──────────────────────────────────────────────

  /**
   * Tìm user theo email qua GSI-1
   * GSI1PK = EMAIL#<email>
   */
  findUserByEmail: async (email: string): Promise<IUser | null> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: USERS_TABLE,
        IndexName: 'GSI-1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': `EMAIL#${email}` },
        Limit: 1,
      }),
    );
    return (result.Items?.[0] as IUser) ?? null;
  },

  /**
   * Tìm user theo userId
   * PK = USER#<userId>, SK = PROFILE
   */
  findUserById: async (userId: string): Promise<IUser | null> => {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: USERS_TABLE,
        Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
      }),
    );
    return (result.Item as IUser) ?? null;
  },

  /**
   * Tạo user mới
   * Sử dụng ConditionExpression để đảm bảo PK chưa tồn tại
   */
  createUser: async (user: IUser): Promise<void> => {
    await dynamoClient.send(
      new PutCommand({
        TableName: USERS_TABLE,
        Item: {
          PK: `USER#${user.userId}`,
          SK: 'PROFILE',
          GSI1PK: `EMAIL#${user.email}`,
          GSI1SK: `EMAIL#${user.email}`,
          ...user,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  },

  /**
   * Cập nhật passwordHash + tăng tokenVersion
   */
  updateUserPassword: async (
    userId: string,
    passwordHash: string,
    tokenVersion: number,
  ): Promise<void> => {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
        UpdateExpression:
          'SET passwordHash = :hash, tokenVersion = :tv, updatedAt = :now',
        ExpressionAttributeValues: {
          ':hash': passwordHash,
          ':tv': tokenVersion,
          ':now': new Date().toISOString(),
        },
      }),
    );
  },

  /**
   * Tăng tokenVersion (dùng để revoke tất cả tokens)
   */
  incrementTokenVersion: async (userId: string): Promise<number> => {
    const result = await dynamoClient.send(
      new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
        UpdateExpression:
          'SET tokenVersion = tokenVersion + :inc, updatedAt = :now',
        ExpressionAttributeValues: {
          ':inc': 1,
          ':now': new Date().toISOString(),
        },
        ReturnValues: 'ALL_NEW',
      }),
    );
    return (result.Attributes as IUser).tokenVersion;
  },

  // ──────────────────────────────────────────────
  // SESSION operations
  // ──────────────────────────────────────────────

  /**
   * Tạo session mới
   */
  createSession: async (session: ISession): Promise<void> => {
    await dynamoClient.send(
      new PutCommand({
        TableName: SESSIONS_TABLE,
        Item: {
          PK: `SESSION#${session.sessionId}`,
          SK: `USER#${session.userId}`,
          GSI1PK: `USER#${session.userId}`,
          GSI1SK: `SESSION#${session.sessionId}`,
          ...session,
        },
      }),
    );
  },

  /**
   * Tìm session theo sessionId + userId
   */
  findSession: async (
    sessionId: string,
    userId: string,
  ): Promise<ISession | null> => {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: SESSIONS_TABLE,
        Key: {
          PK: `SESSION#${sessionId}`,
          SK: `USER#${userId}`,
        },
      }),
    );
    return (result.Item as ISession) ?? null;
  },

  /**
   * Cập nhật refreshTokenHash trong session (cho rotation)
   */
  updateSessionRefreshToken: async (
    sessionId: string,
    userId: string,
    newRefreshTokenHash: string,
  ): Promise<void> => {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: SESSIONS_TABLE,
        Key: {
          PK: `SESSION#${sessionId}`,
          SK: `USER#${userId}`,
        },
        UpdateExpression: 'SET refreshTokenHash = :hash, updatedAt = :now',
        ExpressionAttributeValues: {
          ':hash': newRefreshTokenHash,
          ':now': new Date().toISOString(),
        },
      }),
    );
  },

  /**
   * Xóa 1 session
   */
  deleteSession: async (sessionId: string, userId: string): Promise<void> => {
    await dynamoClient.send(
      new DeleteCommand({
        TableName: SESSIONS_TABLE,
        Key: {
          PK: `SESSION#${sessionId}`,
          SK: `USER#${userId}`,
        },
      }),
    );
  },

  /**
   * Lấy tất cả sessions của 1 user qua GSI-1
   * GSI1PK = USER#<userId>
   */
  findSessionsByUser: async (userId: string): Promise<ISession[]> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: SESSIONS_TABLE,
        IndexName: 'GSI-1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': `USER#${userId}` },
      }),
    );
    return (result.Items as ISession[]) ?? [];
  },

  /**
   * Xóa tất cả sessions của 1 user (batch delete)
   * Dùng khi đổi mật khẩu / revoke all sessions
   */
  deleteAllUserSessions: async (userId: string): Promise<void> => {
    const sessions = await authRepository.findSessionsByUser(userId);

    if (sessions.length === 0) return;

    // BatchWrite tối đa 25 items/lần
    const chunks: ISession[][] = [];
    for (let i = 0; i < sessions.length; i += 25) {
      chunks.push(sessions.slice(i, i + 25));
    }

    for (const chunk of chunks) {
      await dynamoClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [SESSIONS_TABLE]: chunk.map((s) => ({
              DeleteRequest: {
                Key: {
                  PK: `SESSION#${s.sessionId}`,
                  SK: `USER#${s.userId}`,
                },
              },
            })),
          },
        }),
      );
    }
  },

  // ──────────────────────────────────────────────
  // FACE LOGIN operations
  // ──────────────────────────────────────────────

  /**
   * Cập nhật cài đặt face login của user
   */
  updateFaceLogin: async (
    userId: string,
    faceLoginEnabled: boolean,
    rekognitionFaceId: string | null,
  ): Promise<void> => {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
        UpdateExpression:
          'SET faceLoginEnabled = :enabled, rekognitionFaceId = :faceId, updatedAt = :now',
        ExpressionAttributeValues: {
          ':enabled': faceLoginEnabled,
          ':faceId': rekognitionFaceId,
          ':now': new Date().toISOString(),
        },
      }),
    );
  },
};
