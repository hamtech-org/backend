import { getIO } from '@/socket/index.js';
import type { IConversation, IMessage } from './chat.types.js';

// Lazy import để tránh circular dependency — conversation.repository import sau khi module load xong.
let _getConversationMembers: ((id: string) => Promise<{ userId: string }[]>) | null = null;

async function getConversationMembers(conversationId: string) {
  if (!_getConversationMembers) {
    const { conversationRepository } = await import('../conversation/conversation.repository.js');
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
  const {
    outboundStatus: _ob,
    status: _st,
    readBy: _rb,
    ...publicMessage
  } = message as IMessage & {
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

/**
 * Phát một hoặc nhiều sự kiện tới `conv:` và tới `user:` của mọi thành viên
 * (cùng mô hình `message:new` — vẫn nhận realtime khi client không join room hội thoại).
 */
export async function emitEventsToConversationAndMembers(
  conversationId: string,
  emissions: readonly { event: string; payload: unknown }[],
): Promise<void> {
  if (emissions.length === 0) return;
  let io: ReturnType<typeof getIO>;
  try {
    io = getIO();
  } catch {
    return;
  }
  const room = `conv:${conversationId}`;
  for (const { event, payload } of emissions) {
    io.to(room).emit(event, payload);
  }
  const members = await getConversationMembers(conversationId);
  for (const m of members) {
    const userRoom = `user:${m.userId}`;
    for (const { event, payload } of emissions) {
      io.to(userRoom).emit(event, payload);
    }
  }
}

export async function emitToConversationAndMembers(
  conversationId: string,
  event: string,
  payload: unknown,
): Promise<void> {
  await emitEventsToConversationAndMembers(conversationId, [{ event, payload }]);
}

/** Sidebar realtime: thêm/cập nhật hội thoại trên danh sách (tạo nhóm, được mời vào nhóm, …). */
export async function emitConversationCreatedToUser(
  userId: string,
  conversation: IConversation,
): Promise<void> {
  const uid = String(userId ?? '').trim();
  if (!uid) return;
  let io: ReturnType<typeof getIO>;
  try {
    io = getIO();
  } catch {
    return;
  }
  io.to(`user:${uid}`).emit('conversation:created', { conversation });
}

/** Kick / rời nhóm: buộc socket rời room hội thoại để không còn nhận tin realtime. */
export async function forceUserLeaveConversationRoom(
  conversationId: string,
  userId: string,
): Promise<void> {
  let io: ReturnType<typeof getIO>;
  try {
    io = getIO();
  } catch {
    return;
  }
  const room = `conv:${conversationId}`;
  const sockets = await io.in(`user:${userId}`).fetchSockets();
  for (const s of sockets) {
    void s.leave(room);
  }
}

/** Phát sự kiện báo cho user đã xóa lịch sử trò chuyện. */
export async function emitConversationDeletedForMe(
  userId: string,
  payload: {
    conversationId: string;
    type: string;
    clearedAt: string;
    clearedAtMs: number;
    shouldHideFromList: boolean;
  },
): Promise<void> {
  const uid = String(userId ?? '').trim();
  if (!uid) return;
  let io: ReturnType<typeof getIO>;
  try {
    io = getIO();
  } catch {
    return;
  }
  io.to(`user:${uid}`).emit('conversation:deleted_for_me', payload);
}
