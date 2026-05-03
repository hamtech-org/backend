import { Server, Socket } from 'socket.io';
import { registerChatHandlers } from '@/modules/chat/index.js';
import { registerCallHandlers } from '@/modules/call/call.socket.js';
import { registerUserHandlers } from '@/modules/user/user.socket.js';
import { registerNewsfeedHandlers } from '@/modules/newsfeed/newsfeed.socket.js';

export const registerHandlers = (io: Server, socket: Socket): void => {
  const userId = socket.data.userId as string;

  socket.join(`user:${userId}`);

  registerChatHandlers(io, socket);
  registerCallHandlers(io, socket);
  registerUserHandlers(io, socket);
  registerNewsfeedHandlers(io, socket);
};
