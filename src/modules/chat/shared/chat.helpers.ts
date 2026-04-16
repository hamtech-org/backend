import type { IMessage, ILastMessage } from './chat.types.js';
import { userRepository } from '@/modules/user/user.repository.js';

/** Tin không hiển thị với viewer: legacy soft-delete toàn cục hoặc user đã ẩn. */
export function isMessageHiddenFromViewer(m: IMessage, hiddenMessageIds: Set<string>): boolean {
  if (m.isDeleted) return true;
  return hiddenMessageIds.has(m.messageId);
}

export async function messageToLastMessageSnapshot(m: IMessage): Promise<ILastMessage> {
  let content = m.content ?? '';
  if (m.isRecalled) content = 'Tin nhắn đã được thu hồi';
  else if (m.isDeleted) content = 'Tin nhắn đã được xóa';
  const senders = await userRepository.findByIds([m.senderId]);
  const senderDisplayName = senders[0]?.displayName?.trim() ?? null;
  return {
    messageId: m.messageId,
    senderId: m.senderId,
    type: m.type,
    content,
    createdAt: m.createdAt,
    senderDisplayName,
  };
}

export async function lastMessageSnapshotFromNewest(messages: IMessage[]): Promise<ILastMessage | null> {
  if (messages.length === 0) return null;
  return messageToLastMessageSnapshot(messages[0]);
}

/**
 * Tin nhắn cuối còn thấy được với user (bỏ qua ẩn-theo-user và isDeleted legacy).
 * Cần truyền hàm getMessages vào để tránh circular dependency với repository cụ thể.
 */
export async function resolveLastVisibleLastMessageSnapshot(
  conversationId: string,
  hiddenForUser: Set<string>,
  getMessages: (convId: string, limit: number) => Promise<IMessage[]>,
): Promise<ILastMessage | null> {
  const messages = await getMessages(conversationId, 100);
  for (const m of messages) {
    if (isMessageHiddenFromViewer(m, hiddenForUser)) continue;
    return messageToLastMessageSnapshot(m);
  }
  return null;
}

/**
 * Đồng bộ lastMessage trên conversation.
 * Cần truyền hàm getMessages/updateLastMessage/clearLastMessage vào để tránh circular dependency.
 */
export async function syncConversationLastMessageMeta(
  conversationId: string,
  deps: {
    getMessages: (convId: string, limit: number) => Promise<IMessage[]>;
    updateConversationLastMessage: (convId: string, snapshot: ILastMessage, createdAt: string) => Promise<void>;
    clearConversationLastMessage: (convId: string) => Promise<void>;
  },
): Promise<void> {
  const messages = await deps.getMessages(conversationId, 100);
  const snapshot = await lastMessageSnapshotFromNewest(messages);
  if (!snapshot) {
    await deps.clearConversationLastMessage(conversationId);
    return;
  }
  await deps.updateConversationLastMessage(conversationId, snapshot, snapshot.createdAt);
}

export async function attachSenderDisplayNames(messages: IMessage[]): Promise<IMessage[]> {
  if (messages.length === 0) return messages;
  const senderIds = [...new Set(messages.map((m) => m.senderId))];
  const users = await userRepository.findByIds(senderIds);
  const nameById = new Map(users.map((u) => [u.userId, u.displayName]));
  return messages.map((msg) => ({
    ...msg,
    senderDisplayName: nameById.get(msg.senderId) ?? null,
  }));
}

export async function attachReplyToDetails(
  conversationId: string,
  messages: IMessage[],
  hiddenMessageIdsForViewer: Set<string>,
  getMessages: (convId: string, limit: number) => Promise<IMessage[]>,
): Promise<IMessage[]> {
  const replyToIds = messages
    .map((m) => m.replyTo)
    .filter((id): id is string => id !== null && id !== undefined);

  if (replyToIds.length === 0) return messages;

  const allMessagesInConv = await getMessages(conversationId, 100);
  const msgMap = new Map(allMessagesInConv.map((m) => [m.messageId, m]));

  const senderIds = [...new Set(allMessagesInConv.map((m) => m.senderId))];
  const users = await userRepository.findByIds(senderIds);
  const nameById = new Map(users.map((u) => [u.userId, u.displayName]));

  return messages.map((msg) => {
    if (!msg.replyTo) return msg;
    const original = msgMap.get(msg.replyTo);
    if (!original) return msg;

    let content = original.content;
    if (isMessageHiddenFromViewer(original, hiddenMessageIdsForViewer))
      content = '[Tin nhắn không khả dụng]';
    else if (original.isRecalled) content = 'Tin nhắn đã được thu hồi';

    return {
      ...msg,
      replyToDetails: {
        messageId: original.messageId,
        senderId: original.senderId,
        senderDisplayName: nameById.get(original.senderId) ?? null,
        content: content.slice(0, 100),
        type: original.type,
      },
    };
  });
}
