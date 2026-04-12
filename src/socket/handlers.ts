import { Server, Socket } from 'socket.io';
import { registerChatHandlers } from '@/modules/chat/chat.socket.js';
import { registerCallHandlers } from '@/modules/call/call.socket.js';

export const registerHandlers = (io: Server, socket: Socket): void => {
  const userId = socket.data.userId as string;

  socket.join(`user:${userId}`);

  registerChatHandlers(io, socket);
  registerCallHandlers(io, socket);
};
