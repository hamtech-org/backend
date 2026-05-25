import { v4 as uuidv4 } from 'uuid';
import { conversationRepository } from '../conversation/conversation.repository.js';
import { messageUserHideRepository } from '../message/message-user-hide.repository.js';
import {
  filterMessagesByJoinHistoryCutoff,
  isMessageHiddenFromViewer,
  resolveMessageHistoryMinCreatedAtMs,
} from '../shared/chat.helpers.js';
import type { IConversation, IConversationMember, IMessage } from '../shared/chat.types.js';
import { groupRecapSessionRepository } from './recap-session.repository.js';
import type { GroupRecapDismissReason, IGroupRecapSession } from './recap-session.types.js';

const RECAP_SESSION_TTL_MS = 30 * 60 * 1000;

function messageSortKey(message: Pick<IMessage, 'createdAt' | 'messageId'>): string {
  return `MSG#${message.createdAt}#${message.messageId}`;
}

function isRecapCandidateMessage(message: IMessage): boolean {
  if (message.isRecalled || message.isDeleted) return false;
  if (
    (message.type as string) === 'system' ||
    (message as { position?: string }).position === 'center'
  ) {
    return false;
  }
  return true;
}

function isExpired(session: IGroupRecapSession, nowMs = Date.now()): boolean {
  const expiresAtMs = Date.parse(session.expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
}

function nextExpiryIso(nowMs = Date.now()): string {
  return new Date(nowMs + RECAP_SESSION_TTL_MS).toISOString();
}

async function expireIfNeeded(
  session: IGroupRecapSession | null,
): Promise<IGroupRecapSession | null> {
  if (!session || !isExpired(session)) return session;
  if (session.status === 'EXPIRED') return session;

  const now = new Date().toISOString();
  const expired: IGroupRecapSession = {
    ...session,
    status: 'EXPIRED',
    updatedAt: now,
    dismissedAt: now,
    dismissReason: 'expired',
  };
  await groupRecapSessionRepository.putCurrentSession(expired);
  return expired;
}

async function collectUnreadCandidates(params: {
  conversation: IConversation;
  member: IConversationMember;
  userId: string;
  conversationId: string;
  toMessage: IMessage;
}): Promise<IMessage[]> {
  const { conversation, member, userId, conversationId, toMessage } = params;
  const minCreatedAtMs = resolveMessageHistoryMinCreatedAtMs(conversation, member);
  const hiddenMessageIds = await messageUserHideRepository.queryHiddenMessageIdsForConversation(
    userId,
    conversationId,
  );
  const lastReadAtMs = member.lastReadAt ? Date.parse(member.lastReadAt) : Number.NaN;
  const fetchLimit = Math.min(Math.max((member.unreadCount ?? 0) * 4, 40), 500);

  const raw = Number.isFinite(lastReadAtMs)
    ? await conversationRepository.browseMessages(conversationId, {
        dateFrom: new Date(lastReadAtMs).toISOString(),
        dateTo: toMessage.createdAt,
        maxItems: fetchLimit,
      })
    : await conversationRepository.listRecentMessages(conversationId, {
        limit: fetchLimit,
        minCreatedAtMs,
      });

  const toMessageMs = Date.parse(toMessage.createdAt);
  return filterMessagesByJoinHistoryCutoff(
    raw.filter((message) => !isMessageHiddenFromViewer(message, hiddenMessageIds)),
    minCreatedAtMs,
  )
    .filter(isRecapCandidateMessage)
    .filter((message) => message.senderId !== userId)
    .filter((message) => {
      const createdAtMs = Date.parse(message.createdAt);
      if (!Number.isFinite(createdAtMs)) return false;
      if (Number.isFinite(toMessageMs) && createdAtMs > toMessageMs) return false;
      if (!Number.isFinite(lastReadAtMs)) return true;
      return createdAtMs > lastReadAtMs;
    })
    .sort((a, b) => messageSortKey(a).localeCompare(messageSortKey(b)));
}

export const groupRecapSessionService = {
  captureBeforeMarkRead: async (params: {
    conversation: IConversation;
    member: IConversationMember;
    userId: string;
    conversationId: string;
    toMessage: IMessage;
  }): Promise<IGroupRecapSession | null> => {
    const { conversation, member, userId, conversationId } = params;
    if (conversation.type !== 'group') return null;
    if ((member.unreadCount ?? 0) <= 0) return null;

    const current = await expireIfNeeded(
      await groupRecapSessionRepository.getCurrentSession(conversationId, userId),
    );
    const candidates = await collectUnreadCandidates(params);
    if (candidates.length === 0) return current?.status === 'PENDING' ? current : null;

    const oldest = candidates[0]!;
    const newest = candidates[candidates.length - 1]!;
    const now = new Date().toISOString();
    const newestSortKey = messageSortKey(newest);

    if (current?.status === 'PENDING') {
      if (current.toSortKey >= newestSortKey) return current;

      const extended: IGroupRecapSession = {
        ...current,
        toMessageId: newest.messageId,
        toCreatedAt: newest.createdAt,
        toSortKey: newestSortKey,
        unreadCountAtOpen: current.unreadCountAtOpen + (member.unreadCount ?? 0),
        capturedMessageCount: current.capturedMessageCount + candidates.length,
        updatedAt: now,
        expiresAt: nextExpiryIso(),
      };
      await groupRecapSessionRepository.putCurrentSession(extended);
      return extended;
    }

    const next: IGroupRecapSession = {
      recapSessionId: uuidv4(),
      conversationId,
      userId,
      fromMessageId: oldest.messageId,
      fromCreatedAt: oldest.createdAt,
      fromSortKey: messageSortKey(oldest),
      toMessageId: newest.messageId,
      toCreatedAt: newest.createdAt,
      toSortKey: newestSortKey,
      unreadCountAtOpen: member.unreadCount ?? 0,
      capturedMessageCount: candidates.length,
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
      expiresAt: nextExpiryIso(),
    };
    await groupRecapSessionRepository.putCurrentSession(next);
    return next;
  },

  getUsableCurrentSession: async (
    conversationId: string,
    userId: string,
  ): Promise<IGroupRecapSession | null> => {
    const session = await expireIfNeeded(
      await groupRecapSessionRepository.getCurrentSession(conversationId, userId),
    );
    if (!session) return null;
    if (session.status === 'PENDING' || session.status === 'COMPLETED') return session;
    return null;
  },

  saveUnreadSummary: async (
    conversationId: string,
    userId: string,
    recapSessionId: string,
    unreadSummary: string,
  ): Promise<IGroupRecapSession | null> => {
    const current = await groupRecapSessionRepository.getCurrentSession(conversationId, userId);
    if (!current || current.recapSessionId !== recapSessionId) {
      return current ?? null;
    }
    if (current.status !== 'PENDING' && current.status !== 'COMPLETED') return current;

    const now = new Date().toISOString();
    const completed: IGroupRecapSession = {
      ...current,
      status: 'COMPLETED',
      unreadSummary: unreadSummary.trim(),
      completedAt: current.completedAt ?? now,
      updatedAt: now,
    };
    await groupRecapSessionRepository.putCurrentSession(completed);
    return completed;
  },

  dismissPendingSession: async (
    conversationId: string,
    userId: string,
    reason: GroupRecapDismissReason,
  ): Promise<IGroupRecapSession | null> => {
    const current = await expireIfNeeded(
      await groupRecapSessionRepository.getCurrentSession(conversationId, userId),
    );
    if (!current || current.status !== 'PENDING') return current;

    const now = new Date().toISOString();
    const dismissed: IGroupRecapSession = {
      ...current,
      status: 'DISMISSED',
      dismissReason: reason,
      dismissedAt: now,
      updatedAt: now,
    };
    await groupRecapSessionRepository.putCurrentSession(dismissed);
    return dismissed;
  },
};
