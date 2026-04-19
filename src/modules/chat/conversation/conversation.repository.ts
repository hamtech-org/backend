import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import type { IConversation, IConversationMember, IMessage } from '../shared/chat.types.js';
import { isConversationNotificationPushMuted } from '../shared/chat.helpers.js';
import type { MessageStatus } from '@/shared/types/chat.types.js';

const CONVERSATIONS_TABLE = 'Zalogram_Conversations';
const MESSAGES_TABLE = 'Zalogram_Messages';
const MESSAGE_STATUS_TABLE = 'Zalogram_MessageStatus';

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
        unreadCount: typeof item['unreadCount'] === 'number' ? (item['unreadCount'] as number) : 0,
        isMuted,
        isPinnedToTop: !!(item as { isPinnedToTop?: boolean }).isPinnedToTop,
        notificationsMutedUntil,
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
        return {
          ...c,
          unreadCount: p.unreadCount,
          isMuted: p.isMuted,
          isPinnedToTop: p.isPinnedToTop,
          notificationsMutedUntil: p.notificationsMutedUntil ?? undefined,
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
        ExpressionAttributeValues: {
          ':pk': `CONV#${conversationId}`,
          ':memberPrefix': 'MEMBER#',
        },
      }),
    );
    return (result.Items as IConversationMember[]) ?? [];
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

  updateConversation: async (conversationId: string, updates: Partial<IConversation>): Promise<void> => {
    const entries = Object.entries(updates).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return;

    const updateExpr = 'SET ' + entries.map(([,], i) => `#k${i} = :v${i}`).join(', ') + ', updatedAt = :now';
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

  getMember: async (conversationId: string, userId: string): Promise<IConversationMember | null> => {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: `MEMBER#${userId}` },
      }),
    );
    return (result.Item as IConversationMember) ?? null;
  },

  removeMember: async (conversationId: string, userId: string): Promise<void> => {
    await dynamoClient.send(
      new DeleteCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `CONV#${conversationId}`, SK: `MEMBER#${userId}` },
      }),
    );
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

  updateMemberPreferences: async (
    conversationId: string,
    userId: string,
    prefs: {
      isMuted?: boolean;
      isPinnedToTop?: boolean;
      notificationsMutedUntil?: string | null;
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
        if ((m.type as string) === 'system' || (m as { position?: string }).position === 'center') continue;
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
};
