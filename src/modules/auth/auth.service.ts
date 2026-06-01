import jsonwebtoken from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { env } from '@/config/env.js';
import { getRedis } from '@/config/redis.js';
import { logger } from '@/shared/utils/logger.js';
import { getLocationFromIp } from '@/shared/utils/geolocation.js';
import {
  indexFace,
  searchFace,
  deleteFace,
  createLivenessSession,
  detectFaceLiveness,
} from '@/shared/utils/rekognition.js';
import { sendVerificationEmail, sendPasswordResetEmail } from '@/shared/utils/email.js';
import {
  UnauthorizedError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/shared/utils/errors.js';
import { authRepository } from './auth.repository.js';
import { userService } from '@/modules/user/user.service.js';
import {
  emitForceLogout,
  emitAuthSessionsChanged,
  emitNewDeviceLogin,
} from '@/socket/sessionRevoke.notify.js';
import { notificationService } from '@/modules/notification/notification.service.js';
import { deviceTokenRepository } from '@/modules/notification/device-token.repository.js';

import type { ForceLogoutReason } from '@/socket/sessionRevoke.notify.js';
import type { JwtAccessPayload, JwtRefreshPayload } from '@/shared/types/auth.types.js';
import type {
  IRegisterDto,
  ILoginDto,
  ILoginResponse,
  IAuthTokens,
  IRequestMeta,
  ISession,
  IAuthSessionSummary,
} from './auth.types.js';
import type { IUser } from '@/modules/user/user.types.js';

const { sign, verify } = jsonwebtoken;

const SALT_ROUNDS = 12;
const OTP_EXPIRY_SECONDS = 300; // 5 phút
const REGISTRATION_EXPIRY_SECONDS = 600; // 10 phút
const REDIS_RESET_PREFIX = 'password_reset:';
const REDIS_VERIFY_PREFIX = 'email_verify:';
const REDIS_REG_DATA_PREFIX = 'reg_data:';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * Parse chuỗi thời gian (15m, 7d, 1h) sang giây
 */
const parseExpiryToSeconds = (expiry: string): number => {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) return 900;
  const [, num, unit] = match;
  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
  };
  return parseInt(num) * (multipliers[unit] || 60);
};

/**
 * Tạo cặp access + refresh token
 */
const generateTokens = (payload: {
  userId: string;
  email: string;
  role: string;
  sessionId: string;
  tokenVersion: number;
}): IAuthTokens => {
  const accessPayload: JwtAccessPayload = {
    userId: payload.userId,
    email: payload.email,
    role: payload.role as 'user' | 'admin',
    sessionId: payload.sessionId,
  };

  const refreshPayload: JwtRefreshPayload = {
    userId: payload.userId,
    sessionId: payload.sessionId,
    tokenVersion: payload.tokenVersion,
  };

  const accessExpirySeconds = parseExpiryToSeconds(env.JWT_ACCESS_EXPIRY);
  const refreshExpirySeconds = parseExpiryToSeconds(env.JWT_REFRESH_EXPIRY);

  const accessToken = sign(accessPayload, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: accessExpirySeconds,
  });

  const refreshToken = sign(refreshPayload, env.JWT_REFRESH_SECRET, {
    algorithm: 'HS256',
    expiresIn: refreshExpirySeconds,
  });

  return { accessToken, refreshToken, expiresIn: accessExpirySeconds };
};

/**
 * Parse User-Agent thành device info
 */
const parseDeviceInfo = (meta: IRequestMeta): ISession['deviceInfo'] => {
  const userAgent = meta.userAgent;
  const mobileInfo = meta.deviceInfo;
  let os = mobileInfo?.os || 'Unknown';
  let browser = mobileInfo?.appClient || mobileInfo?.browser || 'Unknown';

  // Detect OS
  if (os === 'Unknown') {
    if (userAgent.includes('Android')) os = 'Android';
    else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) os = 'iOS';
    else if (userAgent.includes('Windows')) os = 'Windows';
    else if (userAgent.includes('Mac')) os = 'macOS';
    else if (userAgent.includes('Linux')) os = 'Linux';
  }

  // Detect Browser
  if (browser === 'Unknown') {
    if (userAgent.includes('Edg')) browser = 'Edge';
    else if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) browser = 'Chrome';
    else if (userAgent.includes('Firefox')) browser = 'Firefox';
    else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) browser = 'Safari';
  }

  return {
    userAgent,
    os,
    osVersion: mobileInfo?.osVersion,
    browser,
    deviceName: mobileInfo?.deviceName,
    model: mobileInfo?.model,
    brand: mobileInfo?.brand,
    manufacturer: mobileInfo?.manufacturer,
    appClient: mobileInfo?.appClient,
  };
};

/**
 * Tạo OTP 6 chữ số
 */
const generateOTP = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Tạo session mới và lưu vào DB
 */
const createNewSession = async (
  user: IUser,
  refreshToken: string,
  meta: IRequestMeta,
): Promise<void> => {
  const refreshTokenHash = await bcrypt.hash(refreshToken, SALT_ROUNDS);
  const sessionId = extractSessionIdFromToken(refreshToken);
  const nowSec = Math.floor(Date.now() / 1000);

  const deletedExpired = await authRepository.deleteExpiredUserSessions(user.userId, nowSec);
  if (deletedExpired > 0) {
    logger.info(
      `Deleted ${deletedExpired} expired session(s) before login for user ${user.userId}`,
    );
  }

  // Lấy location từ IP (non-blocking, timeout 3s)
  const location = await getLocationFromIp(meta.ipAddress);
  const nowIso = new Date().toISOString();

  const session: ISession = {
    sessionId,
    userId: user.userId,
    refreshTokenHash,
    deviceInfo: parseDeviceInfo(meta),
    ipAddress: meta.ipAddress,
    location,
    expiresAt: nowSec + parseExpiryToSeconds(env.JWT_REFRESH_EXPIRY),
    isRevoked: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await authRepository.createSession(session);
  emitAuthSessionsChanged(user.userId);
  emitNewDeviceLogin(user.userId, { sessionId: session.sessionId, ipAddress: meta.ipAddress });
  void notificationService
    .dispatch({
      type: 'system',
      userId: user.userId,
      title: 'Đăng nhập thiết bị mới',
      body: meta.ipAddress
        ? `Phát hiện đăng nhập từ IP ${meta.ipAddress}`
        : 'Phát hiện đăng nhập từ thiết bị mới',
      data: {
        route: 'profile',
        id: user.userId,
        extra: { sessionId: session.sessionId, kind: 'new_device_login' },
      },
    })
    .catch((err) => logger.error('new_device_login notification failed:', err));
};

/**
 * Extract sessionId từ refresh token (decode without verify)
 */
const extractSessionIdFromToken = (token: string): string => {
  const decoded = jsonwebtoken.decode(token) as JwtRefreshPayload;
  return decoded.sessionId;
};

/** Socket: báo mọi client đang join room session:* trước khi xóa hàng loạt */
const emitForceLogoutForAllUserSessions = async (
  userId: string,
  reason: ForceLogoutReason,
): Promise<void> => {
  const sessions = await authRepository.findSessionsByUser(userId);
  for (const row of sessions) {
    const s = row as ISession;
    emitForceLogout(s.sessionId, { reason });
  }
};

// ──────────────────────────────────────────────
// Auth Service
// ──────────────────────────────────────────────

export const authService = {
  /**
   * Đăng ký tài khoản mới - Step 1: Gửi OTP
   */
  register: async (data: IRegisterDto): Promise<{ message: string }> => {
    // 1. Kiểm tra email đã tồn tại và đã được xác thực chưa
    const existingUser = await authRepository.findUserByEmail(data.email);
    if (existingUser && existingUser.isVerified) {
      throw new ConflictError('Email đã được sử dụng');
    }

    // 2. Hash password
    const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

    // 3. Lưu trữ tạm thời thông tin đăng ký vào Redis
    const redis = getRedis();
    const registrationData = {
      email: data.email,
      passwordHash,
      displayName: data.displayName,
    };
    await redis.setex(
      `${REDIS_REG_DATA_PREFIX}${data.email}`,
      REGISTRATION_EXPIRY_SECONDS,
      JSON.stringify(registrationData),
    );

    // 4. Tạo OTP và lưu vào Redis
    const otp = generateOTP();
    const otpHash = await bcrypt.hash(otp, SALT_ROUNDS);
    await redis.setex(`${REDIS_VERIFY_PREFIX}${data.email}`, OTP_EXPIRY_SECONDS, otpHash);

    // 5. Gửi OTP qua email
    try {
      await sendVerificationEmail(data.email, otp);
      logger.info(`Verification email sent to ${data.email}`);
    } catch (error) {
      logger.error(`Failed to send verification email to ${data.email}:`, error);
      // Không throw error, user có thể retry
    }

    return { message: 'OTP sent to email for verification.' };
  },

  /**
   * Xác thực email - Step 2: Verify OTP và hoàn tất đăng ký
   */
  verifyEmail: async (email: string, otp: string, meta: IRequestMeta): Promise<ILoginResponse> => {
    const redis = getRedis();

    // 1. Lấy và xác thực OTP
    const storedOtpHash = await redis.get(`${REDIS_VERIFY_PREFIX}${email}`);
    if (!storedOtpHash) {
      throw new ValidationError('OTP đã hết hạn hoặc không hợp lệ.');
    }

    const isOtpValid = await bcrypt.compare(otp, storedOtpHash);
    if (!isOtpValid) {
      throw new ValidationError('OTP không đúng.');
    }

    // 2. Lấy lại thông tin đăng ký từ Redis
    const regDataString = await redis.get(`${REDIS_REG_DATA_PREFIX}${email}`);
    if (!regDataString) {
      throw new ValidationError('Thông tin đăng ký đã hết hạn. Vui lòng thử lại.');
    }
    const regData = JSON.parse(regDataString) as {
      email: string;
      passwordHash: string;
      displayName: string;
    };

    // 3. Tạo user mới trong DB
    const userId = uuidv4();
    const now = new Date().toISOString();
    const newUser: IUser = {
      userId,
      email: regData.email,
      passwordHash: regData.passwordHash,
      displayName: regData.displayName,
      avatar: null,
      bio: null,
      phone: null,
      status: 'offline',
      role: 'user',
      isVerified: true, // Đánh dấu đã xác thực
      lastSeen: null,
      tokenVersion: 0,
      faceLoginEnabled: false,
      rekognitionFaceId: null,
      oauthProvider: 'local',
      oauthId: null,
      settings: {},
      createdAt: now,
      updatedAt: now,
    };

    await authRepository.createUser(newUser);
    logger.info(`User registered and verified: ${userId} (${email})`);

    // Emit event to sync with Elasticsearch
    await userService.emitUserEvent('index', newUser);

    // 4. Xóa data tạm trong Redis
    await redis.del(`${REDIS_VERIFY_PREFIX}${email}`);
    await redis.del(`${REDIS_REG_DATA_PREFIX}${email}`);

    // 5. Tạo tokens + session
    const sessionId = uuidv4();
    const tokens = generateTokens({
      userId,
      email: newUser.email,
      role: 'user',
      sessionId,
      tokenVersion: 0,
    });

    await createNewSession(newUser, tokens.refreshToken, meta);

    return { ...tokens, userId };
  },

  /**
   * Đăng nhập - Step 1: Gửi OTP
   */
  login: async (data: ILoginDto): Promise<{ message: string }> => {
    // 1. Tìm user theo email
    const user = await authRepository.findUserByEmail(data.email);
    if (!user) {
      throw new UnauthorizedError('Email hoặc mật khẩu không đúng');
    }

    // 2. So sánh password
    const isMatch = await bcrypt.compare(data.password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedError('Email hoặc mật khẩu không đúng');
    }

    // 3. Lưu thông tin user tạm thời vào Redis
    const redis = getRedis();
    const loginData = {
      userId: user.userId,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
    };
    await redis.setex(
      `login_data:${data.email}`,
      REGISTRATION_EXPIRY_SECONDS,
      JSON.stringify(loginData),
    );

    // 4. Tạo OTP và lưu vào Redis
    const otp = generateOTP();
    const otpHash = await bcrypt.hash(otp, SALT_ROUNDS);
    await redis.setex(`${REDIS_VERIFY_PREFIX}${data.email}`, OTP_EXPIRY_SECONDS, otpHash);

    // 5. Gửi OTP qua email
    try {
      await sendVerificationEmail(data.email, otp);
      logger.info(`Login verification email sent to ${data.email}`);
    } catch (error) {
      logger.error(`Failed to send login verification email to ${data.email}:`, error);
    }

    return { message: 'OTP sent to email for login verification.' };
  },

  /**
   * Đăng nhập - Step 2: Verify OTP và hoàn tất đăng nhập
   */
  verifyLoginOtp: async (
    email: string,
    otp: string,
    meta: IRequestMeta,
  ): Promise<ILoginResponse> => {
    const redis = getRedis();

    // 1. Lấy và xác thực OTP
    const storedOtpHash = await redis.get(`${REDIS_VERIFY_PREFIX}${email}`);
    if (!storedOtpHash) {
      throw new ValidationError('OTP đã hết hạn hoặc không hợp lệ.');
    }

    const isOtpValid = await bcrypt.compare(otp, storedOtpHash);
    if (!isOtpValid) {
      throw new ValidationError('OTP không đúng.');
    }

    // 2. Lấy lại thông tin login từ Redis
    const loginDataString = await redis.get(`login_data:${email}`);
    if (!loginDataString) {
      throw new ValidationError('Phiên đăng nhập đã hết hạn. Vui lòng thử lại.');
    }
    const loginData = JSON.parse(loginDataString) as {
      userId: string;
      email: string;
      role: string;
      tokenVersion: number;
    };

    // 3. Tìm user để lấy đầy đủ thông tin
    const user = await authRepository.findUserById(loginData.userId);
    if (!user) {
      throw new UnauthorizedError('Tài khoản không tồn tại');
    }

    // 4. Xóa data tạm trong Redis
    await redis.del(`${REDIS_VERIFY_PREFIX}${email}`);
    await redis.del(`login_data:${email}`);

    // 5. Tạo tokens + session
    const sessionId = uuidv4();
    const tokens = generateTokens({
      userId: user.userId,
      email: user.email,
      role: user.role,
      sessionId,
      tokenVersion: user.tokenVersion,
    });

    await createNewSession(user, tokens.refreshToken, meta);
    logger.info(`User logged in with OTP verification: ${user.userId}`);

    return { ...tokens, userId: user.userId };
  },

  /**
   * Refresh token (với rotation — tạo refresh token mới)
   */
  refreshToken: async (
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> => {
    // 1. Verify refresh token
    let decoded: JwtRefreshPayload;
    try {
      decoded = verify(refreshToken, env.JWT_REFRESH_SECRET) as JwtRefreshPayload;
    } catch {
      throw new UnauthorizedError('Refresh token không hợp lệ hoặc đã hết hạn');
    }

    // 2. Tìm session
    const session = await authRepository.findSession(decoded.sessionId, decoded.userId);
    if (!session || session.isRevoked) {
      throw new UnauthorizedError('Session không tồn tại hoặc đã bị thu hồi');
    }

    // 3. Kiểm tra session hết hạn
    if (session.expiresAt < Math.floor(Date.now() / 1000)) {
      await authRepository.deleteSession(decoded.sessionId, decoded.userId);
      emitForceLogout(decoded.sessionId, { reason: 'session_expired' });
      emitAuthSessionsChanged(decoded.userId);
      throw new UnauthorizedError('Session đã hết hạn');
    }

    if (!session.refreshTokenHash) {
      await authRepository.deleteSession(decoded.sessionId, decoded.userId);
      emitForceLogout(decoded.sessionId, { reason: 'session_invalid' });
      emitAuthSessionsChanged(decoded.userId);
      throw new UnauthorizedError('Session không còn hiệu lực');
    }

    // 4. Verify refresh token hash
    const isTokenValid = await bcrypt.compare(refreshToken, session.refreshTokenHash);
    if (!isTokenValid) {
      // Có thể token đã bị đánh cắp → xóa session
      await authRepository.deleteSession(decoded.sessionId, decoded.userId);
      emitForceLogout(decoded.sessionId, { reason: 'token_reuse' });
      emitAuthSessionsChanged(decoded.userId);
      logger.warn(`Possible token theft detected for user ${decoded.userId}, session revoked`);
      throw new UnauthorizedError('Refresh token không khớp — session đã bị thu hồi');
    }

    // 5. Kiểm tra tokenVersion (đã bị revoke qua đổi MK chưa?)
    const user = await authRepository.findUserById(decoded.userId);
    if (!user || user.tokenVersion !== decoded.tokenVersion) {
      await authRepository.deleteSession(decoded.sessionId, decoded.userId);
      emitForceLogout(decoded.sessionId, { reason: 'token_version_revoked' });
      emitAuthSessionsChanged(decoded.userId);
      throw new UnauthorizedError('Token đã bị thu hồi');
    }

    // 6. ROTATION: Tạo tokens mới
    const newTokens = generateTokens({
      userId: user.userId,
      email: user.email,
      role: user.role,
      sessionId: decoded.sessionId,
      tokenVersion: user.tokenVersion,
    });

    // 7. Cập nhật refresh token hash trong session
    const newRefreshHash = await bcrypt.hash(newTokens.refreshToken, SALT_ROUNDS);
    await authRepository.updateSessionRefreshToken(
      decoded.sessionId,
      decoded.userId,
      newRefreshHash,
    );

    logger.debug(`Token rotated for user ${user.userId}, session ${decoded.sessionId}`);

    return {
      accessToken: newTokens.accessToken,
      refreshToken: newTokens.refreshToken,
      expiresIn: newTokens.expiresIn,
    };
  },

  /**
   * Đăng xuất (xóa session hiện tại)
   */
  logout: async (userId: string, sessionId: string, deviceToken?: string): Promise<void> => {
    await authRepository.deleteSession(sessionId, userId);
    if (deviceToken) {
      await deviceTokenRepository.remove(userId, deviceToken);
      logger.info(`Removed device token on logout: ${userId}, token: ${deviceToken}`);
    }
    emitForceLogout(sessionId, { reason: 'logout' });
    emitAuthSessionsChanged(userId);
    logger.info(`User logged out: ${userId}, session: ${sessionId}`);
  },

  /**
   * Danh sách phiên đăng nhập của user (ẩn refreshTokenHash)
   */
  listMySessions: async (
    userId: string,
    currentSessionId: string,
  ): Promise<IAuthSessionSummary[]> => {
    const nowSec = Math.floor(Date.now() / 1000);
    const deletedExpired = await authRepository.deleteExpiredUserSessions(userId, nowSec);
    if (deletedExpired > 0) {
      emitAuthSessionsChanged(userId);
      logger.info(`Deleted ${deletedExpired} expired session(s) while listing sessions: ${userId}`);
    }

    const rows = await authRepository.findSessionsByUser(userId);

    return rows
      .map((row) => {
        const s = row as ISession;
        const isActive = !s.isRevoked && s.expiresAt > nowSec;

        return {
          sessionId: s.sessionId,
          deviceInfo: s.deviceInfo,
          ipAddress: s.ipAddress,
          location: s.location ?? null,
          expiresAt: s.expiresAt,
          isRevoked: s.isRevoked,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          isCurrent: s.sessionId === currentSessionId,
          isActive,
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  /**
   * Thu hồi một phiên khác (hoặc chính phiên hiện tại) theo sessionId
   */
  revokeUserSession: async (userId: string, sessionId: string): Promise<void> => {
    const session = await authRepository.findSession(sessionId, userId);
    if (!session) {
      throw new NotFoundError('Session');
    }
    await authRepository.deleteSession(sessionId, userId);
    emitForceLogout(sessionId, { reason: 'session_revoked' });
    emitAuthSessionsChanged(userId);
    logger.info(`Session deleted by user: ${userId}, session: ${sessionId}`);
  },

  /**
   * Đăng xuất tất cả thiết bị
   */
  logoutAll: async (userId: string): Promise<void> => {
    try {
      const tokens = await deviceTokenRepository.listByUserId(userId);
      await Promise.all(tokens.map((t) => deviceTokenRepository.remove(userId, t.token)));
      logger.info(`Removed all device tokens for user ${userId} on logoutAll`);
    } catch (error) {
      logger.error(`Error removing device tokens in logoutAll for user ${userId}:`, error);
    }

    await emitForceLogoutForAllUserSessions(userId, 'logout_all');
    await authRepository.deleteAllUserSessions(userId);
    emitAuthSessionsChanged(userId);
    await authRepository.incrementTokenVersion(userId);
    logger.info(`All sessions revoked for user: ${userId}`);
  },

  /**
   * Quên mật khẩu — gửi OTP qua email
   */
  forgotPassword: async (email: string): Promise<void> => {
    const user = await authRepository.findUserByEmail(email);

    // Không tiết lộ user có tồn tại hay không (bảo mật)
    if (!user) {
      logger.debug(`Forgot password request for non-existent email: ${email}`);
      return;
    }

    // Tạo OTP và lưu hash vào Redis
    const otp = generateOTP();
    const otpHash = await bcrypt.hash(otp, SALT_ROUNDS);

    const redis = getRedis();
    await redis.setex(`${REDIS_RESET_PREFIX}${user.userId}`, OTP_EXPIRY_SECONDS, otpHash);

    // Gửi OTP qua email
    try {
      await sendPasswordResetEmail(email, otp);
      logger.info(`Password reset email sent to ${email}`);
    } catch (error) {
      logger.error(`Failed to send password reset email to ${email}:`, error);
      // Không throw error, user có thể retry
    }
  },

  /**
   * Reset mật khẩu bằng OTP
   */
  resetPassword: async (email: string, token: string, newPassword: string): Promise<void> => {
    // 1. Tìm user
    const user = await authRepository.findUserByEmail(email);
    if (!user) {
      throw new NotFoundError('User');
    }

    // 2. Kiểm tra OTP từ Redis
    const redis = getRedis();
    const storedOtpHash = await redis.get(`${REDIS_RESET_PREFIX}${user.userId}`);

    if (!storedOtpHash) {
      throw new ValidationError('OTP đã hết hạn hoặc không tồn tại');
    }

    const isOtpValid = await bcrypt.compare(token, storedOtpHash);
    if (!isOtpValid) {
      throw new ValidationError('OTP không đúng');
    }

    // 3. Cập nhật mật khẩu
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    const newTokenVersion = user.tokenVersion + 1;

    await authRepository.updateUserPassword(user.userId, passwordHash, newTokenVersion);

    // 4. Xóa OTP & revoke tất cả sessions
    await redis.del(`${REDIS_RESET_PREFIX}${user.userId}`);
    await emitForceLogoutForAllUserSessions(user.userId, 'password_reset');
    await authRepository.deleteAllUserSessions(user.userId);
    emitAuthSessionsChanged(user.userId);

    logger.info(`Password reset successful for user: ${user.userId}`);
  },

  /**
   * Đổi mật khẩu (user đã đăng nhập)
   */
  changePassword: async (
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> => {
    // 1. Tìm user
    const user = await authRepository.findUserById(userId);
    if (!user) {
      throw new NotFoundError('User');
    }

    // 2. Verify mật khẩu hiện tại
    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedError('Mật khẩu hiện tại không đúng');
    }

    // 3. Hash mật khẩu mới
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    const newTokenVersion = user.tokenVersion + 1;

    // 4. Cập nhật + revoke tất cả sessions (buộc đăng nhập lại)
    await authRepository.updateUserPassword(userId, passwordHash, newTokenVersion);
    await emitForceLogoutForAllUserSessions(userId, 'password_changed');
    await authRepository.deleteAllUserSessions(userId);
    emitAuthSessionsChanged(userId);

    logger.info(`Password changed for user: ${userId} — all sessions revoked`);
  },

  // ──────────────────────────────────────────────
  // FACE LOGIN
  // ──────────────────────────────────────────────

  /**
   * Tạo session mới cho face liveness check
   * Frontend gọi endpoint này để bắt đầu movement challenge
   */
  createLivenessSession: async (): Promise<{ sessionId: string }> => {
    const sessionId = await createLivenessSession();
    return { sessionId };
  },

  /**
   * Bật đăng nhập bằng khuôn mặt
   * - Yêu cầu: user đã đăng nhập (authenticated)
   * - Yêu cầu: user phải nhập đúng mật khẩu hiện tại
   * - Yêu cầu: liveness check đã PASS (anti-spoofing)
   * - Lấy reference image từ AWS Liveness session
   * - Index face vào Rekognition collection
   * - Lưu faceId + bật flag
   */
  enableFaceLogin: async (
    userId: string,
    password: string,
    livenessSessionId: string,
  ): Promise<void> => {
    logger.debug(`0Password verified for user ${userId} before enabling face login`);
    const user = await authRepository.findUserById(userId);
    if (!user) {
      throw new NotFoundError('User');
    }
    logger.debug(`1Password verified for user ${userId} before enabling face login`);
    // 1. Xác thực mật khẩu trước tiên
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new ValidationError('Mật khẩu không đúng');
    }
    logger.debug(`2Password verified for user ${userId} before enabling face login`);
    // 2. Lấy reference image từ AWS Liveness session
    // (Image này đã được AWS xác thực là liveness, không cần imageBase64 từ frontend)
    const livenessResult = await detectFaceLiveness(livenessSessionId);

    logger.debug(
      `3Liveness result for user ${userId}: ${JSON.stringify(livenessResult.confidence)}`,
    );

    if (!livenessResult.isLive) {
      throw new ValidationError(
        `Xác thực khuôn mặt thất bại (độ tin cậy: ${livenessResult.confidence}%). Vui lòng thử lại.`,
      );
    }

    if (!livenessResult.referenceImageBytes) {
      throw new ValidationError('Không thể lấy reference image từ AWS. Vui lòng thử lại.');
    }

    logger.info(
      `Face liveness verified for user ${userId} (confidence: ${livenessResult.confidence}%)`,
    );

    // 3. Nếu đã có face cũ → xóa trước
    if (user.rekognitionFaceId) {
      await deleteFace(user.rekognitionFaceId);
    }

    // 4. Index face từ reference image (đã được AWS xác thực)
    const faceId = await indexFace(userId, livenessResult.referenceImageBytes);

    // 5. Cập nhật DB
    await authRepository.updateFaceLogin(userId, true, faceId);

    logger.info(`Face login enabled for user: ${userId}`);
  },

  /**
   * Tắt đăng nhập bằng khuôn mặt
   */
  disableFaceLogin: async (userId: string): Promise<void> => {
    const user = await authRepository.findUserById(userId);
    if (!user) {
      throw new NotFoundError('User');
    }

    // Xóa face khỏi Rekognition
    if (user.rekognitionFaceId) {
      await deleteFace(user.rekognitionFaceId);
    }

    // Cập nhật DB
    await authRepository.updateFaceLogin(userId, false, null);

    logger.info(`Face login disabled for user: ${userId}`);
  },

  /**
   * Đăng nhập bằng khuôn mặt
   * - User phải gửi email để xác thực nhân thân
   * - Yêu cầu: liveness check đã PASS (anti-spoofing)
   * - Yêu cầu: user đã bật faceLoginEnabled
   * - Lấy reference image từ AWS Liveness session
   * - Tìm face trong Rekognition → match userId → xác thực email → tạo session
   */
  loginWithFace: async (
    email: string,
    livenessSessionId: string,
    meta: IRequestMeta,
  ): Promise<ILoginResponse> => {
    // Validate email parameter
    if (!email || typeof email !== 'string') {
      logger.error('Email parameter missing or invalid:', { email, type: typeof email });
      throw new ValidationError('Email là bắt buộc');
    }

    const trimmedEmail = email.trim().toLowerCase();

    // 1. Lấy reference image từ AWS Liveness session
    // (Image này đã được AWS xác thực là liveness, không cần imageBase64 từ frontend)
    const livenessResult = await detectFaceLiveness(livenessSessionId);

    if (!livenessResult.isLive) {
      logger.warn(
        `Face liveness verification FAILED for email ${trimmedEmail} (confidence: ${livenessResult.confidence}%)`,
      );
      throw new UnauthorizedError(
        `Xác thực khuôn mặt thất bại (độ tin cậy: ${livenessResult.confidence}%). Vui lòng thử lại.`,
      );
    }

    if (!livenessResult.referenceImageBytes) {
      throw new UnauthorizedError('Không thể lấy reference image từ AWS. Vui lòng thử lại.');
    }

    // 2. Tìm khuôn mặt trong collection bằng reference image từ AWS
    const match = await searchFace(livenessResult.referenceImageBytes);
    if (!match) {
      logger.warn('Face not recognized');
      throw new UnauthorizedError('Không nhận diện được khuôn mặt');
    }

    // 3. Tìm user
    const user = await authRepository.findUserById(match.userId);
    if (!user) {
      logger.error('User not found for userId:', match.userId);
      throw new UnauthorizedError('Tài khoản không tồn tại');
    }

    // 4. Xác thực email khớp với face được nhận diện
    if (user.email.toLowerCase() !== trimmedEmail) {
      logger.warn(
        `Face login EMAIL MISMATCH detected: provided "${trimmedEmail}", user account "${user.email.toLowerCase()}"`,
      );
      throw new UnauthorizedError('Email không khớp với khuôn mặt được xác thực');
    }

    // 5. Kiểm tra đã bật face login chưa
    if (!user.faceLoginEnabled) {
      logger.warn(`Face login not enabled for user ${user.userId}`);
      throw new UnauthorizedError('Tài khoản chưa bật đăng nhập bằng khuôn mặt');
    }

    // 6. Tạo tokens + session
    const sessionId = uuidv4();
    const tokens = generateTokens({
      userId: user.userId,
      email: user.email,
      role: user.role,
      sessionId,
      tokenVersion: user.tokenVersion,
    });

    await createNewSession(user, tokens.refreshToken, meta);
    logger.info(
      `Face login successful for user ${user.userId} (${user.email}, liveness: ${livenessResult.confidence}%, face similarity: ${match.similarity.toFixed(1)}%)`,
    );

    return { ...tokens, userId: user.userId };
  },
};
