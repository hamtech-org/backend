import jsonwebtoken from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { env } from '@/config/env.js';
import { getRedis } from '@/config/redis.js';
import { logger } from '@/shared/utils/logger.js';
import { getLocationFromIp } from '@/shared/utils/geolocation.js';
import { indexFace, searchFace, deleteFace } from '@/shared/utils/rekognition.js';
import { sendVerificationEmail, sendPasswordResetEmail } from '@/shared/utils/email.js';
import {
  UnauthorizedError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/shared/utils/errors.js';
import { authRepository } from './auth.repository.js';
import type { JwtAccessPayload, JwtRefreshPayload } from '@/shared/types/auth.types.js';
import type {
  IRegisterDto,
  ILoginDto,
  ILoginResponse,
  IAuthTokens,
  IRequestMeta,
  ISession,
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
const parseDeviceInfo = (
  userAgent: string,
): { userAgent: string; os: string; browser: string } => {
  let os = 'Unknown';
  let browser = 'Unknown';

  // Detect OS
  if (userAgent.includes('Android')) os = 'Android';
  else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) os = 'iOS';
  else if (userAgent.includes('Windows')) os = 'Windows';
  else if (userAgent.includes('Mac')) os = 'macOS';
  else if (userAgent.includes('Linux')) os = 'Linux';

  // Detect Browser
  if (userAgent.includes('Edg')) browser = 'Edge';
  else if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) browser = 'Chrome';
  else if (userAgent.includes('Firefox')) browser = 'Firefox';
  else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) browser = 'Safari';

  return { userAgent, os, browser };
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

  // Lấy location từ IP (non-blocking, timeout 3s)
  const location = await getLocationFromIp(meta.ipAddress);

  const session: ISession = {
    sessionId,
    userId: user.userId,
    refreshTokenHash,
    deviceInfo: parseDeviceInfo(meta.userAgent),
    ipAddress: meta.ipAddress,
    location,
    expiresAt: Math.floor(Date.now() / 1000) + parseExpiryToSeconds(env.JWT_REFRESH_EXPIRY),
    isRevoked: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await authRepository.createSession(session);
};

/**
 * Extract sessionId từ refresh token (decode without verify)
 */
const extractSessionIdFromToken = (token: string): string => {
  const decoded = jsonwebtoken.decode(token) as JwtRefreshPayload;
  return decoded.sessionId;
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
    await redis.setex(
      `${REDIS_VERIFY_PREFIX}${data.email}`,
      OTP_EXPIRY_SECONDS,
      otpHash,
    );

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
  verifyEmail: async (
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

    // 2. Lấy lại thông tin đăng ký từ Redis
    const regDataString = await redis.get(`${REDIS_REG_DATA_PREFIX}${email}`);
    if (!regDataString) {
      throw new ValidationError('Thông tin đăng ký đã hết hạn. Vui lòng thử lại.');
    }
    const regData = JSON.parse(regDataString);

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
    await redis.setex(
      `${REDIS_VERIFY_PREFIX}${data.email}`,
      OTP_EXPIRY_SECONDS,
      otpHash,
    );

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
    const loginData = JSON.parse(loginDataString);

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
      throw new UnauthorizedError('Session đã hết hạn');
    }

    // 4. Verify refresh token hash
    const isTokenValid = await bcrypt.compare(refreshToken, session.refreshTokenHash);
    if (!isTokenValid) {
      // Có thể token đã bị đánh cắp → revoke session
      await authRepository.deleteSession(decoded.sessionId, decoded.userId);
      logger.warn(`Possible token theft detected for user ${decoded.userId}, session revoked`);
      throw new UnauthorizedError('Refresh token không khớp — session đã bị thu hồi');
    }

    // 5. Kiểm tra tokenVersion (đã bị revoke qua đổi MK chưa?)
    const user = await authRepository.findUserById(decoded.userId);
    if (!user || user.tokenVersion !== decoded.tokenVersion) {
      await authRepository.deleteSession(decoded.sessionId, decoded.userId);
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
   * Đăng xuất (xóa 1 session)
   */
  logout: async (userId: string, sessionId: string): Promise<void> => {
    await authRepository.deleteSession(sessionId, userId);
    logger.info(`User logged out: ${userId}, session: ${sessionId}`);
  },

  /**
   * Đăng xuất tất cả thiết bị
   */
  logoutAll: async (userId: string): Promise<void> => {
    await authRepository.deleteAllUserSessions(userId);
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
  resetPassword: async (
    email: string,
    token: string,
    newPassword: string,
  ): Promise<void> => {
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
    await authRepository.deleteAllUserSessions(user.userId);

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
    await authRepository.deleteAllUserSessions(userId);

    logger.info(`Password changed for user: ${userId} — all sessions revoked`);
  },

  // ──────────────────────────────────────────────
  // FACE LOGIN
  // ──────────────────────────────────────────────

  /**
   * Bật đăng nhập bằng khuôn mặt
   * - Yêu cầu: user đã đăng nhập (authenticated)
   * - Index face vào Rekognition collection
   * - Lưu faceId + bật flag
   */
  enableFaceLogin: async (userId: string, imageBase64: string): Promise<void> => {
    const user = await authRepository.findUserById(userId);
    if (!user) {
      throw new NotFoundError('User');
    }

    // Nếu đã có face cũ → xóa trước
    if (user.rekognitionFaceId) {
      await deleteFace(user.rekognitionFaceId);
    }

    // Decode base64 → Buffer
    // Strip data:image/...;base64, prefix nếu có
    const base64Data = imageBase64.includes(',')
      ? imageBase64.split(',')[1]
      : imageBase64;
    const imageBytes = Buffer.from(base64Data, 'base64');

    // Index face vào Rekognition
    const faceId = await indexFace(userId, imageBytes);

    // Cập nhật DB
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
   * - User phải đã bật faceLoginEnabled
   * - Tìm face trong Rekognition → match userId → tạo session
   */
  loginWithFace: async (
    imageBase64: string,
    meta: IRequestMeta,
  ): Promise<ILoginResponse> => {
    // Strip data:image/...;base64, prefix nếu có
    const base64Data = imageBase64.includes(',')
      ? imageBase64.split(',')[1]
      : imageBase64;
    const imageBytes = Buffer.from(base64Data, 'base64');

    // 1. Tìm khuôn mặt trong collection
    const match = await searchFace(imageBytes);
    if (!match) {
      throw new UnauthorizedError('Không nhận diện được khuôn mặt');
    }

    // 2. Tìm user
    const user = await authRepository.findUserById(match.userId);
    if (!user) {
      throw new UnauthorizedError('Tài khoản không tồn tại');
    }

    // 3. Kiểm tra đã bật face login chưa
    if (!user.faceLoginEnabled) {
      throw new UnauthorizedError('Tài khoản chưa bật đăng nhập bằng khuôn mặt');
    }

    // 4. Tạo tokens + session
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
      `Face login successful for user ${user.userId} (similarity: ${match.similarity.toFixed(1)}%)`,
    );

    return { ...tokens, userId: user.userId };
  },
};
