import { getIO } from '@/socket/index.js';
import type { IMessage } from './chat.types.js';

// Lazy import để tránh circular dependency — conversation.repository import sau khi module load xong.
let _getConversationMembers: ((id: string) => Promise<{ userId: string }[]>) | null = null;

async function getConversationMembers(conversationId: string) {
  if (!_getConversationMembers) {
    const { conversationRepository } = await import(
      '../conversation/conversation.repository.js'
    );
    _getConversationMembers = conversationRepository.getConversationMembers;
  }
  return _getConversationMembers(conversationId);
}

/**
 * Phát message:new tới room hội thoại (typing / đang mở thread) và tới room cá nhân
 * user:* của mọi thành viên — client vẫn nhận tin khi đã conversation:leave khỏi conv.
 */
export async function broadcastMessageNew(message: IMessage): Promise<void> {
  let io: ReturnType<typeof getIO>;
  try {
    io = getIO();
  } catch {
    return;
  }
  const { conversationId } = message;
  const { outboundStatus: _ob, status: _st, readBy: _rb, ...publicMessage } = message as IMessage & {
    outboundStatus?: unknown;
    status?: unknown;
    readBy?: unknown;
  };
  io.to(`conv:${conversationId}`).emit('message:new', publicMessage);
  const members = await getConversationMembers(conversationId);
  for (const m of members) {
    io.to(`user:${m.userId}`).emit('message:new', publicMessage);
  }
}
