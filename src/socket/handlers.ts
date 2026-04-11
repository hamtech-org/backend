import { Server, Socket } from 'socket.io';
import { registerCallHandlers } from '@/modules/call/call.socket.js';

export const registerHandlers = (io: Server, socket: Socket): void => {
  const userId = socket.data.userId as string;

  socket.join(`user:${userId}`);

  registerCallHandlers(io, socket);
};
