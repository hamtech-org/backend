import { Server, Socket } from 'socket.io';
import { registerChatHandlers } from '@/modules/chat/chat.socket.js';

// TODO: import signaling socket handlers khi triển khai WebRTC

export const registerHandlers = (io: Server, socket: Socket): void => {
  const userId = socket.data.userId as string;

  // Tham gia room cá nhân để nhận thông báo trực tiếp
  socket.join(`user:${userId}`);

  // Đăng ký chat handlers (nhắn tin real-time)
  registerChatHandlers(io, socket);

  // TODO: Đăng ký signaling handlers (WebRTC gọi video/thoại)
  // registerSignalingHandlers(io, socket);
};
