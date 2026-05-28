import { Socket } from 'socket.io';
import jsonwebtoken from 'jsonwebtoken';
import { env } from '@/config/env.js';
import { logger } from '@/shared/utils/logger.js';
import { userRepository } from '@/modules/user/user.repository.js';
import type { JwtAccessPayload } from '@/shared/types/auth.types.js';

const { verify } = jsonwebtoken;

export const authenticateSocket = async (
  socket: Socket,
  next: (err?: Error) => void,
): Promise<void> => {
  try {
    const token = socket.handshake.auth.token as string | undefined;
    if (!token) {
      return next(new Error('Token không được cung cấp'));
    }

    const decoded = verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
    }) as JwtAccessPayload;

    socket.data.userId = decoded.userId;
    socket.data.email = decoded.email;
    socket.data.role = decoded.role;
    if (decoded.sessionId) {
      socket.data.sessionId = decoded.sessionId;
    } else {
      logger.debug('Socket auth: access token không có sessionId — bỏ qua join room session');
    }

    const user = await userRepository.findById(decoded.userId);
    if (user) {
      socket.data.displayName = user.displayName;
      socket.data.avatar = user.avatar;
    }

    next();
  } catch (error) {
    logger.warn('Socket auth thất bại:', error);
    next(new Error('Token không hợp lệ'));
  }
};
