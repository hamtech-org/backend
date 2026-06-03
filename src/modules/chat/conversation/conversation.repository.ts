import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import { env } from '@/config/env.js';
import type {
  IConversation,
  IConversationMember,
  IGroupRoleAuditLog,
  IMessage,
} from '../shared/chat.types.js';
import { isConversationNotificationPushMuted } from '../shared/chat.helpers.js';
import type { MessageStatus } from '@/shared/types/chat.types.js';

const CONVERSATIONS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Conversations`;
const MESSAGES_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Messages`;
const MESSAGE_STATUS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}MessageStatus`;

export const conversationRepository = {
  // ─── Conversations ───────────────────────────────────────────────────

  getConversationById: async (conversationId: string): Promise<IConversation | null> => {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: 'META' },
      }),
    );
    return (result.Item as IConversation) ?? null;
  },

  /**
   * Lấy danh sách hội thoại của user qua GSI-2 (userId PK)
   * GSI-2: userId (PK) — Tìm tất cả hội thoại của user
   */
  getConversations: async (userId: string): Promise<IConversation[]> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: CONVERSATIONS_TABLE,
        IndexName: 'GSI-2',
        KeyConditionExpression: 'userId = :uid',
        FilterExpression: 'begins_with(SK, :memberPrefix)',
        ExpressionAttributeValues: {
          ':uid': userId,
          ':memberPrefix': 'MEMBER#',
        },
      }),
    );

    if (!result.Items || result.Items.length === 0) return [];

    const prefsByConvId = new Map<
      string,
      {
        unreadCount: number;
        isMuted: boolean;
        isPinnedToTop: boolean;
        notificationsMutedUntil: string | null | undefined;
        clearedAt?: string | null;
        clearedAtMs?: number | null;
        clearedUntilSK?: string | null;
        revealedAt?: string | null;
        revealedAtMs?: number | null;
        conversationListAt?: string | null;
        conversationListAtMs?: number | null;
      }
    >();
    for (const item of result.Items) {
      const pk = item['PK'] as string;
      const convId = pk.replace('CONV#', '');
      const rawMuted = !!item['isMuted'];
      const untilRaw = (item as { notificationsMutedUntil?: unknown }).notificationsMutedUntil;
      const notificationsMutedUntil =
        typeof untilRaw === 'string' && untilRaw.length > 0 ? untilRaw : null;
      const isMuted = isConversationNotificationPushMuted({
        isMuted: rawMuted,
        notificationsMutedUntil: notificationsMutedUntil ?? undefined,
      });
      prefsByConvId.set(convId, {
        unreadCount: typeof item['unreadCount'] === 'number' ? item['unreadCount'] : 0,
        isMuted,
        isPinnedToTop: !!(item as { isPinnedToTop?: boolean }).isPinnedToTop,
        notificationsMutedUntil,
        clearedAt: (item as { clearedAt?: string }).clearedAt ?? null,
        clearedAtMs:
          typeof (item as { clearedAtMs?: number }).clearedAtMs === 'number'
            ? (item as { clearedAtMs?: number }).clearedAtMs
            : null,
        clearedUntilSK: (item as { clearedUntilSK?: string }).clearedUntilSK ?? null,
        revealedAt: (item as { revealedAt?: string }).revealedAt ?? null,
        revealedAtMs:
          typeof (item as { revealedAtMs?: number }).revealedAtMs === 'number'
            ? (item as { revealedAtMs?: number }).revealedAtMs
            : null,
        conversationListAt: (item as { conversationListAt?: string }).conversationListAt ?? null,
        conversationListAtMs:
          typeof (item as { conversationListAtMs?: number }).conversationListAtMs === 'number'
            ? (item as { conversationListAtMs?: number }).conversationListAtMs
            : null,
      });
    }

    const convIds = [...prefsByConvId.keys()];

    // Fetch META cho từng conversation, gộp unread / mute / ghim từ MEMBER#
    const conversations = await Promise.all(
      convIds.map((id) => conversationRepository.getConversationById(id)),
    );

    return conversations
      .filter((c): c is IConversation => c !== null)
      .map((c) => {
        const p = prefsByConvId.get(c.conversationId);
        if (!p) return c;
        const lastMsgAtMs = c.lastMessageAt ? Date.parse(c.lastMessageAt) : 0;
        const listAtMs = Math.max(lastMsgAtMs, p.conversationListAtMs || 0);
        const listAt = listAtMs > 0 ? new Date(listAtMs).toISOString() : c.lastMessageAt;
        return {
          ...c,
          unreadCount: p.unreadCount,
          isMuted: p.isMuted,
          isPinnedToTop: p.isPinnedToTop,
          notificationsMutedUntil: p.notificationsMutedUntil ?? undefined,
          clearedAt: p.clearedAt,
          clearedAtMs: p.clearedAtMs,
          clearedUntilSK: p.clearedUntilSK,
          revealedAt: p.revealedAt,
          revealedAtMs: p.revealedAtMs,
          conversationListAt: listAt,
          conversationListAtMs: listAtMs,
        };
      });
  },

  /**
   * META: không ghi null cho lastMessage / lastMessageAt (GSI key kiểu String — DynamoDB từ chối NULL).
   */
  createConversation: async (conversation: IConversation): Promise<void> => {
    const { lastMessage, lastMessageAt, name, avatar, isDeleted, ...rest } = conversation;
    const item: Record<string, unknown> = {
      PK: `CONV#${conversation.conversationId}`,
      SK: 'META',
      ...rest,
    };
    if (name != null) item['name'] = name;
    if (avatar != null) item['avatar'] = avatar;
    if (lastMessage != null) item['lastMessage'] = lastMessage;
    if (lastMessageAt != null) item['lastMessageAt'] = lastMessageAt;
    if (isDeleted === true) item['isDeleted'] = isDeleted;

    await dynamoClient.send(
      new PutCommand({
        TableName: CONVERSATIONS_TABLE,
        Item: item,
      }),
    );
  },

  /**
   * Thêm thành viên vào conversation
   * PK: CONV#{conversationId}, SK: MEMBER#{userId}
   * userId được lưu thêm cho GSI-2
   * Không ghi null cho lastReadAt / nickname (DynamoDB Document Client).
   */
  addConversationMember: async (member: IConversationMember): Promise<void> => {
    const { lastReadAt, nickname, ...rest } = member;
    const item: Record<string, unknown> = {
      PK: `CONV#${member.conversationId}`,
      SK: `MEMBER#${member.userId}`,
      ...rest,
      userId: member.userId,
    };
    if (lastReadAt != null) item['lastReadAt'] = lastReadAt;
    if (nickname != null) item['nickname'] = nickname;

    await dynamoClient.send(
      new PutCommand({
        TableName: CONVERSATIONS_TABLE,
        Item: item,
      }),
    );
  },

  getConversationMembers: async (conversationId: string): Promise<IConversationMember[]> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: CONVERSATIONS_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :memberPrefix)',
        ConsistentRead: true,
        ExpressionAttributeValues: {
          ':pk': `CONV#${conversationId}`,
          ':memberPrefix': 'MEMBER#',
        },
      }),
    );
    const items = (result.Items as Array<IConversationMember & { SK?: string }>) ?? [];
    const byUserId = new Map<string, IConversationMember>();
    for (const raw of items) {
      const sk = String(raw.SK ?? '');
      if (!sk.startsWith('MEMBER#')) continue;
      const fromSk = sk.slice('MEMBER#'.length).trim();
      const userId = (fromSk || String(raw.userId ?? '').trim()).trim();
      if (!userId) continue;
      byUserId.set(userId, { ...raw, conversationId, userId });
    }
    return [...byUserId.values()];
  },

  /** Tìm MEMBER# theo userId (khớp SK hoặc field) — dùng khi kick/remove. */
  resolveMemberForRemoval: async (
    conversationId: string,
    userId: string,
  ): Promise<{ member: IConversationMember; deleteUserId: string } | null> => {
    const trimmed = userId.trim();
    if (!trimmed) return null;

    const direct = await conversationRepository.getMember(conversationId, trimmed);
    if (direct) {
      return { member: direct, deleteUserId: trimmed };
    }

    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: CONVERSATIONS_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :memberPrefix)',
        ExpressionAttributeValues: {
          ':pk': `CONV#${conversationId}`,
          ':memberPrefix': 'MEMBER#',
        },
      }),
    );

    for (const raw of result.Items ?? []) {
      const sk = String((raw as { SK?: string }).SK ?? '');
      if (!sk.startsWith('MEMBER#')) continue;
      const skUserId = sk.slice('MEMBER#'.length).trim();
      const itemUserId = String((raw as IConversationMember).userId ?? '').trim();
      if (skUserId !== trimmed && itemUserId !== trimmed) continue;
      const deleteUserId = skUserId || itemUserId || trimmed;
      return {
        member: { ...(raw as IConversationMember), conversationId, userId: deleteUserId },
        deleteUserId,
      };
    }
    return null;
  },

  updateConversationLastMessage: async (
    conversationId: string,
    lastMessage: IConversation['lastMessage'],
    lastMessageAt: string,
  ): Promise<void> => {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: 'META' },
        UpdateExpression: 'SET lastMessage = :lm, lastMessageAt = :lma, updatedAt = :now',
        ExpressionAttributeValues: {
          ':lm': lastMessage,
          ':lma': lastMessageAt,
          ':now': new Date().toISOString(),
        },
      }),
    );
  },

  clearConversationLastMessage: async (conversationId: string): Promise<void> => {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: 'META' },
        UpdateExpression: 'REMOVE lastMessage, lastMessageAt SET updatedAt = :now',
        ExpressionAttributeValues: {
          ':now': new Date().toISOString(),
        },
      }),
    );
  },

  /**
   * Tìm conversation 1-1 đã tồn tại giữa 2 user
   * Lấy danh sách conv của userA rồi kiểm tra xem userB có trong đó không
   */
  findDirectConversation: async (
    userAId: string,
    userBId: string,
  ): Promise<IConversation | null> => {
    const convs = await conversationRepository.getConversations(userAId);
    for (const conv of convs) {
      if (conv.type !== 'direct') continue;
      const members = await conversationRepository.getConversationMembers(conv.conversationId);
      const memberIds = members.map((m) => m.userId);
      if (memberIds.includes(userBId)) return conv;
    }
    return null;
  },

  deleteConversation: async (conversationId: string): Promise<void> => {
    await dynamoClient.send(
      new DeleteCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: 'META' },
      }),
    );
  },

  updateConversation: async (
    conversationId: string,
    updates: Partial<IConversation>,
  ): Promise<void> => {
    const entries = Object.entries(updates).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return;

    const updateExpr =
      'SET ' + entries.map(([,], i) => `#k${i} = :v${i}`).join(', ') + ', updatedAt = :now';
    const attrNames = Object.fromEntries(entries.map(([k], i) => [`#k${i}`, k]));
    const attrValues = {
      ...Object.fromEntries(entries.map(([, v], i) => [`:v${i}`, v])),
      ':now': new Date().toISOString(),
    };

    await dynamoClient.send(
      new UpdateCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: 'META' },
        UpdateExpression: updateExpr,
        ExpressionAttributeNames: attrNames,
        ExpressionAttributeValues: attrValues,
      }),
    );
  },

  /** Chỉ đổi `updatedAt` — dùng bust cache avatar nhóm ghép tự động. */
  touchConversationUpdatedAt: async (conversationId: string): Promise<void> => {
    const cid = String(conversationId ?? '').trim();
    if (!cid) return;
    await dynamoClient.send(
      new UpdateCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${cid}`, SK: 'META' },
        UpdateExpression: 'SET updatedAt = :now',
        ExpressionAttributeValues: { ':now': new Date().toISOString() },
      }),
    );
  },

  getMember: async (
    conversationId: string,
    userId: string,
  ): Promise<IConversationMember | null> => {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: CONVERSATIONS_TABLE,
        ConsistentRead: true,
        Key: { PK: `CONV#${conversationId}`, SK: `MEMBER#${userId}` },
      }),
    );
    return (result.Item as IConversationMember) ?? null;
  },

  revealConversationForUser: async (
    conversationId: string,
    userId: string,
    nowIso: string,
    nowMs: number,
  ): Promise<void> => {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: `MEMBER#${userId}` },
        UpdateExpression:
          'SET revealedAt = :rAt, revealedAtMs = :rAtMs, conversationListAt = :cAt, conversationListAtMs = :cAtMs',
        ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
        ExpressionAttributeValues: {
          ':rAt': nowIso,
          ':rAtMs': nowMs,
          ':cAt': nowIso,
          ':cAtMs': nowMs,
        },
      }),
    );
  },

  removeMember: async (conversationId: string, userId: string): Promise<void> => {
    await conversationRepository.removeAllMemberRecordsForUser(conversationId, userId);
  },

  /**
   * Xóa mọi MEMBER# trùng user (SK hoặc field userId) — tránh phải kick 2 lần khi dữ liệu lệch.
   */
  removeAllMemberRecordsForUser: async (
    conversationId: string,
    userId: string,
  ): Promise<number> => {
    const trimmed = userId.trim();
    if (!trimmed) return 0;

    const pk = `CONV#${conversationId}`;
    const deletedKeys = new Set<string>();

    const deleteMemberKey = async (itemPk: string, itemSk: string): Promise<void> => {
      const sig = `${itemPk}\0${itemSk}`;
      if (deletedKeys.has(sig)) return;
      await dynamoClient.send(
        new DeleteCommand({
          TableName: CONVERSATIONS_TABLE,
          Key: { PK: itemPk, SK: itemSk },
        }),
      );
      deletedKeys.add(sig);
    };

    try {
      await deleteMemberKey(pk, `MEMBER#${trimmed}`);
    } catch {
      /* ignore */
    }

    let convStartKey: Record<string, unknown> | undefined;
    do {
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: CONVERSATIONS_TABLE,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :memberPrefix)',
          ExpressionAttributeValues: {
            ':pk': pk,
            ':memberPrefix': 'MEMBER#',
          },
          ExclusiveStartKey: convStartKey,
        }),
      );

      for (const raw of result.Items ?? []) {
        const sk = String((raw as { SK?: string }).SK ?? '');
        if (!sk.startsWith('MEMBER#')) continue;
        const skUserId = sk.slice('MEMBER#'.length).trim();
        const itemUserId = String((raw as IConversationMember).userId ?? '').trim();
        if (skUserId !== trimmed && itemUserId !== trimmed) continue;
        await deleteMemberKey(pk, sk);
      }

      convStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (convStartKey);

    let gsiStartKey: Record<string, unknown> | undefined;
    do {
      const gsi = await dynamoClient.send(
        new QueryCommand({
          TableName: CONVERSATIONS_TABLE,
          IndexName: 'GSI-2',
          KeyConditionExpression: 'userId = :uid',
          FilterExpression: 'PK = :pk AND begins_with(SK, :memberPrefix)',
          ExpressionAttributeValues: {
            ':uid': trimmed,
            ':pk': pk,
            ':memberPrefix': 'MEMBER#',
          },
          ExclusiveStartKey: gsiStartKey,
        }),
      );

      for (const raw of gsi.Items ?? []) {
        const itemPk = String((raw as { PK?: string }).PK ?? '');
        const sk = String((raw as { SK?: string }).SK ?? '');
        if (itemPk !== pk || !sk.startsWith('MEMBER#')) continue;
        await deleteMemberKey(itemPk, sk);
      }

      gsiStartKey = gsi.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (gsiStartKey);

    return deletedKeys.size;
  },

  updateMemberRole: async (conversationId: string, userId: string, role: string): Promise<void> => {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: `MEMBER#${userId}` },
        UpdateExpression: 'SET #r = :role, updatedAt = :now',
        ExpressionAttributeNames: { '#r': 'role' },
        ExpressionAttributeValues: {
          ':role': role,
          ':now': new Date().toISOString(),
        },
      }),
    );
  },

  createGroupRoleAuditLog: async (log: IGroupRoleAuditLog): Promise<void> => {
    await dynamoClient.send(
      new PutCommand({
        TableName: CONVERSATIONS_TABLE,
        Item: {
          PK: `CONV#${log.conversationId}`,
          SK: `ROLE_AUDIT#${log.createdAt}#${log.auditId}`,
          entityType: 'GROUP_ROLE_AUDIT',
          ...log,
        },
      }),
    );
  },

  applyGroupOwnerTransfer: async (params: {
    conversationId: string;
    newOwnerUserId: string;
    previousOwnerUserId: string;
    previousOwnerNewRole: string;
    extraOwnerDemotions?: Array<{ userId: string; nextRole: string }>;
    auditLogs?: IGroupRoleAuditLog[];
  }): Promise<void> => {
    const now = new Date().toISOString();
    const pk = `CONV#${params.conversationId}`;
    const memberUpdates = new Map<string, string>();
    memberUpdates.set(params.newOwnerUserId, 'owner');
    memberUpdates.set(params.previousOwnerUserId, params.previousOwnerNewRole);
    for (const demotion of params.extraOwnerDemotions ?? []) {
      if (!demotion.userId || demotion.userId === params.newOwnerUserId) continue;
      memberUpdates.set(demotion.userId, demotion.nextRole);
    }

    await dynamoClient.send(
      new TransactWriteCommand({
        TransactItems: [
          ...[...memberUpdates.entries()].map(([userId, role]) => ({
            Update: {
              TableName: CONVERSATIONS_TABLE,
              Key: { PK: pk, SK: `MEMBER#${userId}` },
              UpdateExpression: 'SET #r = :role, updatedAt = :now',
              ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
              ExpressionAttributeNames: { '#r': 'role' },
              ExpressionAttributeValues: {
                ':role': role,
                ':now': now,
              },
            },
          })),
          {
            Update: {
              TableName: CONVERSATIONS_TABLE,
              Key: { PK: pk, SK: 'META' },
              UpdateExpression: 'SET leaderId = :leaderId, updatedAt = :now',
              ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
              ExpressionAttributeValues: {
                ':leaderId': params.newOwnerUserId,
                ':now': now,
              },
            },
          },
          ...(params.auditLogs ?? []).map((log) => ({
            Put: {
              TableName: CONVERSATIONS_TABLE,
              Item: {
                PK: pk,
                SK: `ROLE_AUDIT#${log.createdAt}#${log.auditId}`,
                entityType: 'GROUP_ROLE_AUDIT',
                ...log,
              },
            },
          })),
        ],
      }),
    );
  },

  /**
   * Cập nhật unreadCount cho member trong conversation
   */
  updateMemberUnreadCount: async (
    conversationId: string,
    userId: string,
    increment: number,
  ): Promise<void> => {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: `MEMBER#${userId}` },
        UpdateExpression: 'ADD unreadCount :inc',
        ExpressionAttributeValues: { ':inc': increment },
      }),
    );
  },

  resetMemberUnreadCount: async (conversationId: string, userId: string): Promise<void> => {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: `MEMBER#${userId}` },
        UpdateExpression: 'SET unreadCount = :zero, lastReadAt = :now',
        ExpressionAttributeValues: {
          ':zero': 0,
          ':now': new Date().toISOString(),
        },
      }),
    );
  },

  /** Cộng dồn trên META (ADD tạo thuộc tính nếu chưa có). */
  adjustPinnedMessageCount: async (conversationId: string, delta: number): Promise<void> => {
    if (delta === 0) return;
    await dynamoClient.send(
      new UpdateCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: 'META' },
        UpdateExpression: 'ADD pinnedMessageCount :d SET updatedAt = :now',
        ExpressionAttributeValues: {
          ':d': delta,
          ':now': new Date().toISOString(),
        },
      }),
    );
  },

  setPinnedMessageCount: async (conversationId: string, count: number): Promise<void> => {
    const safe = Math.max(0, Math.floor(count));
    await dynamoClient.send(
      new UpdateCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: 'META' },
        UpdateExpression: 'SET pinnedMessageCount = :c, updatedAt = :now',
        ExpressionAttributeValues: {
          ':c': safe,
          ':now': new Date().toISOString(),
        },
      }),
    );
  },

  /**
   * Đếm tin ghim còn hiệu lực (không thu hồi / không xóa).
   * Dùng để sửa lệch `pinnedMessageCount` trên META so với thực tế.
   */
  countActivePinnedMessages: async (conversationId: string): Promise<number> => {
    const PIN_FILTER =
      'isPinned = :pinned AND (attribute_not_exists(isRecalled) OR isRecalled = :false) AND (attribute_not_exists(isDeleted) OR isDeleted = :false)';
    let count = 0;
    let exclusiveStartKey: Record<string, unknown> | undefined;
    const PAGE = 80;
    let rounds = 0;

    while (rounds < 40) {
      rounds += 1;
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: MESSAGES_TABLE,
          KeyConditionExpression: 'PK = :pk',
          FilterExpression: PIN_FILTER,
          ExpressionAttributeValues: {
            ':pk': `CONV#${conversationId}`,
            ':pinned': true,
            ':false': false,
          },
          Limit: PAGE,
          ScanIndexForward: false,
          ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
        }),
      );

      const items = (result.Items as IMessage[]) ?? [];
      count += items.length;
      exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
      if (!exclusiveStartKey) break;
    }

    return count;
  },

  updateMemberPreferences: async (
    conversationId: string,
    userId: string,
    prefs: {
      isMuted?: boolean;
      isPinnedToTop?: boolean;
      notificationsMutedUntil?: string | null;
      clearedAt?: string | null;
      clearedAtMs?: number | null;
      clearedUntilSK?: string | null;
    },
  ): Promise<void> => {
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const setTokens: string[] = [];
    const removeTokens: string[] = [];
    let i = 0;

    if (prefs.isMuted !== undefined) {
      names[`#s${i}`] = 'isMuted';
      values[`:s${i}`] = prefs.isMuted;
      setTokens.push(`#s${i} = :s${i}`);
      i++;
    }
    if (prefs.isPinnedToTop !== undefined) {
      names[`#s${i}`] = 'isPinnedToTop';
      values[`:s${i}`] = prefs.isPinnedToTop;
      setTokens.push(`#s${i} = :s${i}`);
      i++;
    }
    if (prefs.notificationsMutedUntil !== undefined) {
      if (prefs.notificationsMutedUntil === null) {
        names['#rmUntil'] = 'notificationsMutedUntil';
        removeTokens.push('#rmUntil');
      } else {
        names[`#s${i}`] = 'notificationsMutedUntil';
        values[`:s${i}`] = prefs.notificationsMutedUntil;
        setTokens.push(`#s${i} = :s${i}`);
        i++;
      }
    }
    if (prefs.clearedAt !== undefined) {
      if (prefs.clearedAt === null) {
        names['#rmClearedAt'] = 'clearedAt';
        removeTokens.push('#rmClearedAt');
      } else {
        names[`#s${i}`] = 'clearedAt';
        values[`:s${i}`] = prefs.clearedAt;
        setTokens.push(`#s${i} = :s${i}`);
        i++;
      }
    }
    if (prefs.clearedAtMs !== undefined) {
      if (prefs.clearedAtMs === null) {
        names['#rmClearedAtMs'] = 'clearedAtMs';
        removeTokens.push('#rmClearedAtMs');
      } else {
        names[`#s${i}`] = 'clearedAtMs';
        values[`:s${i}`] = prefs.clearedAtMs;
        setTokens.push(`#s${i} = :s${i}`);
        i++;
      }
    }
    if (prefs.clearedUntilSK !== undefined) {
      if (prefs.clearedUntilSK === null) {
        names['#rmClearedUntilSK'] = 'clearedUntilSK';
        removeTokens.push('#rmClearedUntilSK');
      } else {
        names[`#s${i}`] = 'clearedUntilSK';
        values[`:s${i}`] = prefs.clearedUntilSK;
        setTokens.push(`#s${i} = :s${i}`);
        i++;
      }
    }

    if (setTokens.length === 0 && removeTokens.length === 0) return;

    const parts: string[] = [];
    if (setTokens.length) parts.push(`SET ${setTokens.join(', ')}`);
    if (removeTokens.length) parts.push(`REMOVE ${removeTokens.join(', ')}`);

    await dynamoClient.send(
      new UpdateCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: `MEMBER#${userId}` },
        UpdateExpression: parts.join(' '),
        ExpressionAttributeNames: names,
        ...(Object.keys(values).length > 0 ? { ExpressionAttributeValues: values } : {}),
      }),
    );
  },

  // ─── Messages (shared foundation) ────────────────────────────────────

  /**
   * Lấy ngữ cảnh tin nhắn quanh một anchor message.
   * - before: số tin nhắn trước anchor (theo thời gian)
   * - after: số tin nhắn sau anchor (theo thời gian)
   * - onlyBetweenUsers: nếu set thì chỉ giữ tin của 2 user (me/their) để dùng cho gợi ý trả lời
   */
  getMessageContext: async (
    conversationId: string,
    anchorMessageId: string,
    opts?: {
      before?: number;
      after?: number;
      onlyBetweenUsers?: { meUserId: string; theirUserId: string };
    },
  ): Promise<{ anchor: IMessage; before: IMessage[]; after: IMessage[] }> => {
    const beforeN = Math.min(Math.max(0, opts?.before ?? 20), 100);
    const afterN = Math.min(Math.max(0, opts?.after ?? 5), 100);

    const anchor = await conversationRepository.findMessageByMessageId(
      conversationId,
      anchorMessageId,
    );
    if (!anchor) {
      throw new Error('Anchor message not found');
    }

    const anchorSk = `MSG#${anchor.createdAt}#${anchor.messageId}`;
    const pk = `CONV#${conversationId}`;

    const isAllowedSender = opts?.onlyBetweenUsers
      ? (senderId: string) =>
          senderId === opts.onlyBetweenUsers!.meUserId ||
          senderId === opts.onlyBetweenUsers!.theirUserId
      : undefined;

    const shouldKeep = (m: IMessage) => {
      if (m.isRecalled || m.isDeleted) return false;
      if ((m.type as string) === 'system' || (m as { position?: string }).position === 'center')
        return false;
      if (isAllowedSender && !isAllowedSender(m.senderId)) return false;
      return true;
    };

    const [beforeRes, afterRes] = await Promise.all([
      beforeN > 0
        ? dynamoClient.send(
            new QueryCommand({
              TableName: MESSAGES_TABLE,
              KeyConditionExpression: 'PK = :pk AND SK < :sk',
              ExpressionAttributeValues: {
                ':pk': pk,
                ':sk': anchorSk,
              },
              Limit: beforeN,
              ScanIndexForward: false,
            }),
          )
        : Promise.resolve({ Items: [] as unknown[] }),
      afterN > 0
        ? dynamoClient.send(
            new QueryCommand({
              TableName: MESSAGES_TABLE,
              KeyConditionExpression: 'PK = :pk AND SK > :sk',
              ExpressionAttributeValues: {
                ':pk': pk,
                ':sk': anchorSk,
              },
              Limit: afterN,
              ScanIndexForward: true,
            }),
          )
        : Promise.resolve({ Items: [] as unknown[] }),
    ]);

    const before = ((beforeRes as { Items?: unknown[] }).Items as IMessage[] | undefined) ?? [];
    const after = ((afterRes as { Items?: unknown[] }).Items as IMessage[] | undefined) ?? [];

    const filteredBefore = before.filter(shouldKeep).reverse();
    const filteredAfter = after.filter(shouldKeep);

    return { anchor, before: filteredBefore, after: filteredAfter };
  },

  getMessages: async (conversationId: string, limit: number = 20): Promise<IMessage[]> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: MESSAGES_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `CONV#${conversationId}` },
        Limit: limit,
        ScanIndexForward: false,
      }),
    );
    return (result.Items as IMessage[]) ?? [];
  },

  listMessagesInSortKeyRange: async (
    conversationId: string,
    opts: { fromSortKey: string; toSortKey: string; limit: number },
  ): Promise<IMessage[]> => {
    const limit = Math.min(Math.max(1, opts.limit), 500);
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: MESSAGES_TABLE,
        KeyConditionExpression: 'PK = :pk AND SK BETWEEN :from AND :to',
        ExpressionAttributeValues: {
          ':pk': `CONV#${conversationId}`,
          ':from': opts.fromSortKey,
          ':to': opts.toSortKey,
        },
        Limit: limit,
        ScanIndexForward: true,
      }),
    );
    return (result.Items as IMessage[]) ?? [];
  },

  /**
   * Tin gần đây (mới → cũ), phân trang Dynamo.
   * `minCreatedAtMs`: bỏ qua tin cũ hơn mốc (dùng khi tắt đọc tin trước khi vào nhóm).
   */
  listRecentMessages: async (
    conversationId: string,
    opts: { limit: number; minCreatedAtMs?: number | null; clearedUntilSK?: string | null },
  ): Promise<IMessage[]> => {
    const limit = Math.min(Math.max(1, opts.limit), 500);
    const minMs = opts.minCreatedAtMs;
    const hasCutoff = minMs != null && Number.isFinite(minMs);
    const clearedUntilSK = opts.clearedUntilSK;
    const collected: IMessage[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    const PAGE = 64;
    let rounds = 0;

    while (collected.length < limit && rounds < 24) {
      rounds += 1;
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: MESSAGES_TABLE,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': `CONV#${conversationId}` },
          Limit: PAGE,
          ScanIndexForward: false,
          ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
        }),
      );

      const items = (result.Items as IMessage[]) ?? [];
      if (items.length === 0) break;

      let reachedHistoryCutoff = false;
      for (const m of items) {
        if (clearedUntilSK && m.SK && m.SK <= clearedUntilSK) {
          reachedHistoryCutoff = true;
          continue;
        }
        if (hasCutoff) {
          const t = Date.parse(m.createdAt);
          if (Number.isFinite(t) && t < minMs!) {
            reachedHistoryCutoff = true;
            continue;
          }
        }
        collected.push(m);
        if (collected.length >= limit) break;
      }

      exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
      if (!exclusiveStartKey) break;
      if (reachedHistoryCutoff) break;
    }

    return collected;
  },

  /**
   * Cursor-based paginated message listing (mới → cũ from DynamoDB, reversed to oldest→newest by service).
   * Returns items + raw DynamoDB ExclusiveStartKey for cursor construction.
   */
  listRecentMessagesPaginated: async (
    conversationId: string,
    opts: {
      limit: number;
      minCreatedAtMs?: number | null;
      clearedUntilSK?: string | null;
      exclusiveStartKey?: Record<string, unknown>;
    },
  ): Promise<{ items: IMessage[]; lastEvaluatedKey?: Record<string, unknown> }> => {
    const limit = Math.min(Math.max(1, opts.limit), 100);
    const minMs = opts.minCreatedAtMs;
    const hasCutoff = minMs != null && Number.isFinite(minMs);
    const clearedUntilSK = opts.clearedUntilSK;
    const collected: IMessage[] = [];
    let exclusiveStartKey = opts.exclusiveStartKey;
    const PAGE = Math.min(limit + 10, 100);
    let rounds = 0;
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    while (collected.length < limit && rounds < 12) {
      rounds += 1;
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: MESSAGES_TABLE,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': `CONV#${conversationId}` },
          Limit: PAGE,
          ScanIndexForward: false,
          ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
        }),
      );

      const items = (result.Items as IMessage[]) ?? [];
      if (items.length === 0) {
        lastEvaluatedKey = undefined;
        break;
      }

      let reachedHistoryCutoff = false;
      for (const m of items) {
        if (clearedUntilSK && m.SK && m.SK <= clearedUntilSK) {
          reachedHistoryCutoff = true;
          continue;
        }
        if (hasCutoff) {
          const t = Date.parse(m.createdAt);
          if (Number.isFinite(t) && t < minMs!) {
            reachedHistoryCutoff = true;
            continue;
          }
        }
        collected.push(m);
        if (collected.length >= limit) break;
      }

      lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
      if (!lastEvaluatedKey) break;
      if (reachedHistoryCutoff) {
        lastEvaluatedKey = undefined;
        break;
      }
      exclusiveStartKey = lastEvaluatedKey;
    }

    return { items: collected, lastEvaluatedKey };
  },

  /**
   * Lấy tin theo người gửi và/hoặc khoảng createdAt (ISO), phân trang Query + FilterExpression.
   * Cần ít nhất một trong: senderId hoặc (dateFrom + dateTo).
   */
  browseMessages: async (
    conversationId: string,
    opts: { senderId?: string; dateFrom?: string; dateTo?: string; maxItems: number },
  ): Promise<IMessage[]> => {
    const PAGE = 64;
    const maxItems = Math.min(Math.max(1, opts.maxItems), 500);
    const collected: IMessage[] = [];

    const filterParts: string[] = [];
    const exprValues: Record<string, unknown> = {
      ':pk': `CONV#${conversationId}`,
    };
    const exprNames: Record<string, string> = {};

    if (opts.senderId) {
      filterParts.push('senderId = :sid');
      exprValues[':sid'] = opts.senderId;
    }
    if (opts.dateFrom && opts.dateTo) {
      exprNames['#ca'] = 'createdAt';
      filterParts.push('#ca >= :df AND #ca <= :dt');
      exprValues[':df'] = opts.dateFrom;
      exprValues[':dt'] = opts.dateTo;
    }

    if (filterParts.length === 0) {
      return [];
    }

    let exclusiveStartKey: Record<string, unknown> | undefined;
    let rounds = 0;

    while (collected.length < maxItems && rounds < 48) {
      rounds += 1;
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: MESSAGES_TABLE,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: exprValues,
          FilterExpression: filterParts.join(' AND '),
          ...(Object.keys(exprNames).length > 0 ? { ExpressionAttributeNames: exprNames } : {}),
          Limit: PAGE,
          ScanIndexForward: false,
          ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
        }),
      );

      const items = (result.Items as IMessage[]) ?? [];
      for (const m of items) {
        if (m.isRecalled || m.isDeleted) continue;
        if ((m.type as string) === 'system' || (m as { position?: string }).position === 'center')
          continue;
        collected.push(m);
        if (collected.length >= maxItems) break;
      }

      exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
      if (!exclusiveStartKey) break;
    }

    return collected;
  },

  /** Tìm tin theo messageId (query gần đây, dùng cho read / delivered). */
  findMessageByMessageId: async (
    conversationId: string,
    messageId: string,
  ): Promise<IMessage | null> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: MESSAGES_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        FilterExpression: 'messageId = :mid',
        ExpressionAttributeValues: {
          ':pk': `CONV#${conversationId}`,
          ':sk': 'MSG#',
          ':mid': messageId,
        },
        Limit: 60,
        ScanIndexForward: false,
      }),
    );
    const items = (result.Items as IMessage[] | undefined) ?? [];
    return items.find((i) => i.messageId === messageId) ?? null;
  },

  findMessageByMessageIdWithoutLimit: async (
    conversationId: string,
    messageId: string,
  ): Promise<IMessage | null> => {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: MESSAGES_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        FilterExpression: 'messageId = :mid',
        ExpressionAttributeValues: {
          ':pk': `CONV#${conversationId}`,
          ':sk': 'MSG#',
          ':mid': messageId,
        },
      }),
    );
    const items = (result.Items as IMessage[] | undefined) ?? [];
    return items.find((i) => i.messageId === messageId) ?? null;
  },

  getMessageById: async (
    conversationId: string,
    messageId: string,
    createdAt: string,
  ): Promise<IMessage | null> => {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: MESSAGES_TABLE,
        Key: {
          PK: `CONV#${conversationId}`,
          SK: `MSG#${createdAt}#${messageId}`,
        },
      }),
    );
    return (result.Item as IMessage) ?? null;
  },

  createMessage: async (message: IMessage): Promise<void> => {
    await dynamoClient.send(
      new PutCommand({
        TableName: MESSAGES_TABLE,
        Item: {
          PK: `CONV#${message.conversationId}`,
          SK: `MSG#${message.createdAt}#${message.messageId}`,
          ...message,
        },
      }),
    );
  },

  updateMessage: async (
    conversationId: string,
    messageId: string,
    sortKey: string,
    updates: Partial<IMessage>,
  ): Promise<void> => {
    const entries = Object.entries(updates).filter(([, v]) => v !== undefined);
    const updateExpr = entries.map(([,], i) => `#k${i} = :v${i}`).join(', ');

    await dynamoClient.send(
      new UpdateCommand({
        TableName: MESSAGES_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: sortKey },
        UpdateExpression: `SET ${updateExpr}, updatedAt = :now`,
        ExpressionAttributeNames: Object.fromEntries(entries.map(([k], i) => [`#k${i}`, k])),
        ExpressionAttributeValues: {
          ...Object.fromEntries(entries.map(([, v], i) => [`:v${i}`, v])),
          ':now': new Date().toISOString(),
        },
      }),
    );
    void messageId;
  },

  // ─── Message Status ───────────────────────────────────────────────────

  updateMessageStatus: async (
    messageId: string,
    userId: string,
    status: MessageStatus,
  ): Promise<void> => {
    const now = new Date().toISOString();
    await dynamoClient.send(
      new PutCommand({
        TableName: MESSAGE_STATUS_TABLE,
        Item: {
          PK: `MSG#${messageId}`,
          SK: `STATUS#${userId}`,
          messageId,
          userId,
          status,
          ...(status === 'delivered' ? { deliveredAt: now } : {}),
          ...(status === 'read' ? { readAt: now } : {}),
        },
      }),
    );
  },

  /** PK=JOIN#{suffix}, SK=META — tra cứu nhóm theo link mời (O(1)). */
  upsertJoinLinkLookup: async (conversationId: string, suffix: string): Promise<void> => {
    const normalized = suffix.trim().toLowerCase();
    if (!normalized) return;
    await dynamoClient.send(
      new PutCommand({
        TableName: CONVERSATIONS_TABLE,
        Item: {
          PK: `JOIN#${normalized}`,
          SK: 'META',
          conversationId,
          joinLinkSuffix: normalized,
          updatedAt: new Date().toISOString(),
        },
      }),
    );
  },

  deleteJoinLinkLookup: async (suffix: string): Promise<void> => {
    const normalized = suffix.trim().toLowerCase();
    if (!normalized) return;
    await dynamoClient.send(
      new DeleteCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `JOIN#${normalized}`, SK: 'META' },
      }),
    );
  },

  findConversationIdByJoinLinkSuffix: async (suffix: string): Promise<string | null> => {
    const normalized = suffix.trim().toLowerCase();
    if (!normalized) return null;
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `JOIN#${normalized}`, SK: 'META' },
      }),
    );
    const conversationId = String(
      (result.Item as { conversationId?: string })?.conversationId ?? '',
    ).trim();
    return conversationId || null;
  },

  updateGroupId: async (conversationId: string, groupId: string | null): Promise<void> => {
    if (groupId) {
      await dynamoClient.send(
        new UpdateCommand({
          TableName: CONVERSATIONS_TABLE,
          Key: { PK: `CONV#${conversationId}`, SK: 'META' },
          UpdateExpression: 'SET groupId = :groupId, updatedAt = :now',
          ExpressionAttributeValues: {
            ':groupId': groupId,
            ':now': new Date().toISOString(),
          },
        }),
      );
    } else {
      await dynamoClient.send(
        new UpdateCommand({
          TableName: CONVERSATIONS_TABLE,
          Key: { PK: `CONV#${conversationId}`, SK: 'META' },
          UpdateExpression: 'REMOVE groupId SET updatedAt = :now',
          ExpressionAttributeValues: {
            ':now': new Date().toISOString(),
          },
        }),
      );
    }
  },
};
