import { v4 as uuidv4 } from 'uuid';
import type { IMessage, ILastMessage } from './chat.types.js';
import { userRepository } from '@/modules/user/user.repository.js';
import { broadcastMessageNew } from './chat.broadcast.js';

/**
 * Tạo, lưu, cập nhật lastMessage, và broadcast system message.
 * Thay thế ~480 dòng trùng lặp trong toàn bộ module chat.
 *
 * Dependencies (createMessage & updateConversationLastMessage) được truyền vào
 * để tránh circular dependency với conversation.repository.
 */
export async function createAndBroadcastSystemMessage(
  params: {
    conversationId: string;
    senderId: string;
    content: string;
    mediaUrl?: string | null;
    mediaType?: string | null;
  },
  deps: {
    createMessage: (msg: IMessage) => Promise<void>;
    updateConversationLastMessage: (
      convId: string,
      lastMessage: ILastMessage,
      lastMessageAt: string,
    ) => Promise<void>;
  },
): Promise<IMessage> {
  let senderDisplayName = 'Ai đó';
  try {
    const senders = await userRepository.findByIds([params.senderId]);
    senderDisplayName = senders[0]?.displayName?.trim() || 'Ai đó';
  } catch {
    // ignore
  }

  const now = new Date().toISOString();
  const messageId = uuidv4();

  const systemMessage: IMessage = {
    messageId,
    conversationId: params.conversationId,
    senderId: params.senderId,
    senderDisplayName,
    type: 'system' as any,
    content: params.content,
    encryptedContent: null,
    mediaUrl: params.mediaUrl ?? null,
    mediaType: params.mediaType ?? null,
    mediaSize: null,
    mediaOriginalName: null,
    thumbnailUrl: null,
    replyTo: null,
    replyToDetails: null,
    forwardFrom: null,
    isPinned: false,
    isEdited: false,
    isRecalled: false,
    isDeleted: false,
    reactions: {},
    createdAt: now,
    updatedAt: now,
  };

  await deps.createMessage(systemMessage);
  await deps.updateConversationLastMessage(
    params.conversationId,
    {
      messageId,
      senderId: params.senderId,
      content: params.content,
      type: 'system' as any,
      createdAt: now,
      senderDisplayName,
    },
    now,
  );

  try {
    await broadcastMessageNew(systemMessage);
  } catch {
    /* ignore broadcast errors */
  }

  return systemMessage;
}
