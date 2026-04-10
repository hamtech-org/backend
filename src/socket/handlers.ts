import { Server, Socket } from 'socket.io';
import { registerChatHandlers } from '@/modules/chat/chat.socket.js';

export const registerHandlers = (io: Server, socket: Socket): void => {
  const userId = socket.data.userId as string;

  // Tham gia room cá nhân
  socket.join(`user:${userId}`);

  // Đăng ký chat handlers
  registerChatHandlers(io, socket);

  // TODO: Đăng ký signaling handlers (WebRTC)
  // registerSignalingHandlers(io, socket);
};
