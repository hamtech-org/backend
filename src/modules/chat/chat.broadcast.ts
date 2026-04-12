import { getIO } from '@/socket/index.js';
import { chatRepository } from './chat.repository.js';
import type { IMessage } from './chat.types.js';

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
  io.to(`conv:${conversationId}`).emit('message:new', message);
  const members = await chatRepository.getConversationMembers(conversationId);
  for (const m of members) {
    io.to(`user:${m.userId}`).emit('message:new', message);
  }
}
