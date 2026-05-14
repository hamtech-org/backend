import { getIO } from '@/socket/index.js';
import { logger } from '@/shared/utils/logger.js';

export type ForceLogoutReason =
  | 'session_revoked'
  | 'logout'
  | 'session_expired'
  | 'session_invalid'
  | 'token_reuse'
  | 'token_version_revoked'
  | 'logout_all'
  | 'password_changed'
  | 'password_reset';

export interface ForceLogoutPayload {
  reason: ForceLogoutReason;
}

/**
 * Báo client (room theo sessionId) đăng xuất ngay — UX; API vẫn dựa JWT tới khi access hết hạn.
 */
export const emitForceLogout = (sessionId: string, payload: ForceLogoutPayload): void => {
  try {
    const io = getIO();
    io.to(`session:${sessionId}`).emit('auth:force_logout', payload);
    logger.debug(`Emitted auth:force_logout to session:${sessionId} (${payload.reason})`);
  } catch (e) {
    logger.warn('emitForceLogout: Socket.io chưa sẵn sàng hoặc lỗi emit', e);
  }
};

/** Mọi tab/thiết bị cùng user đang mở socket — refetch danh sách phiên (Profile, v.v.) */
export const emitAuthSessionsChanged = (userId: string): void => {
  try {
    const io = getIO();
    io.to(`user:${userId}`).emit('auth:sessions_changed', {});
    logger.debug(`Emitted auth:sessions_changed to user:${userId}`);
  } catch (e) {
    logger.warn('emitAuthSessionsChanged: Socket.io chưa sẵn sàng hoặc lỗi emit', e);
  }
};

export interface NewDeviceLoginPayload {
  sessionId: string;
  ipAddress?: string;
}

/** Các phiên khác của cùng user: có đăng nhập / phiên mới (client tự bỏ qua nếu trùng sessionId JWT). */
export const emitNewDeviceLogin = (userId: string, payload: NewDeviceLoginPayload): void => {
  try {
    const io = getIO();
    io.to(`user:${userId}`).emit('auth:new_device_login', payload);
    logger.debug(`Emitted auth:new_device_login to user:${userId} (${payload.sessionId})`);
  } catch (e) {
    logger.warn('emitNewDeviceLogin: Socket.io chưa sẵn sàng hoặc lỗi emit', e);
  }
};
