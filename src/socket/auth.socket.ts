import { Socket } from 'socket.io';
import jsonwebtoken from 'jsonwebtoken';
import { env } from '@/config/env.js';
import { logger } from '@/shared/utils/logger.js';

const { verify } = jsonwebtoken;

interface SocketAuthPayload {
  userId: string;
  email: string;
  role: 'user' | 'admin';
}

export const authenticateSocket = (socket: Socket, next: (err?: Error) => void): void => {
  try {
    const token = socket.handshake.auth.token as string | undefined;
    if (!token) {
      return next(new Error('Token không được cung cấp'));
    }

    const decoded = verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
    }) as SocketAuthPayload;

    socket.data.userId = decoded.userId;
    socket.data.email = decoded.email;
    socket.data.role = decoded.role;

    next();
  } catch (error) {
    logger.warn('Socket auth thất bại:', error);
    next(new Error('Token không hợp lệ'));
  }
};
