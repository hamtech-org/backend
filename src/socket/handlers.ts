import { Server, Socket } from 'socket.io';

// TODO: import chat socket handlers
// TODO: import signaling socket handlers

export const registerHandlers = (io: Server, socket: Socket): void => {
  const userId = socket.data.userId as string;

  // Tham gia room cá nhân
  socket.join(`user:${userId}`);

  // TODO: Đăng ký chat handlers
  // registerChatHandlers(io, socket);

  // TODO: Đăng ký signaling handlers (WebRTC)
  // registerSignalingHandlers(io, socket);
};
