import { authService } from '../auth.service.js';
import { authRepository } from '../auth.repository.js';
import { getRedis } from '@/config/redis.js';
import bcrypt from 'bcryptjs';
import { UnauthorizedError, ValidationError } from '@/shared/utils/errors.js';

jest.mock('../auth.repository.js', () => ({
  authRepository: {
    findUserByEmail: jest.fn(),
    findUserById: jest.fn(),
    createSession: jest.fn(),
    deleteExpiredUserSessions: jest.fn(),
  },
}));

jest.mock('@/config/redis.js', () => {
  const mockRedis = {
    get: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
  };
  return {
    getRedis: jest.fn().mockReturnValue(mockRedis),
  };
});

jest.mock('@/shared/utils/email.js', () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
}));

describe('Auth Service - Login + OTP Unit Tests', () => {
  const email = 'user@test.com';
  const password = 'Password123';
  const mockUser = {
    userId: 'user-id-123',
    email,
    passwordHash: 'hashed-password',
    role: 'user',
    tokenVersion: 0,
  };
  const mockRequestMeta = {
    ipAddress: '127.0.0.1',
    userAgent: 'Mozilla/5.0',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('TC01 (Pass): login step 1 should succeed with valid password and send OTP', async () => {
    (authRepository.findUserByEmail as jest.Mock).mockResolvedValue(mockUser);
    jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(true));

    const result = await authService.login({ email, password });

    expect(authRepository.findUserByEmail).toHaveBeenCalledWith(email);
    expect(result.message).toContain('OTP sent');
  });

  it('TC02 (Pass): login step 1 should throw UnauthorizedError on incorrect password', async () => {
    (authRepository.findUserByEmail as jest.Mock).mockResolvedValue(mockUser);
    jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(false));

    await expect(authService.login({ email, password })).rejects.toThrow(
      'Email hoặc mật khẩu không đúng',
    );
  });

  it('TC03 (Pass): verifyLoginOtp should log user in when OTP is correct', async () => {
    const redisMock = getRedis();
    (redisMock.get as jest.Mock)
      .mockResolvedValueOnce('hashed-otp') // storedOtpHash
      .mockResolvedValueOnce(
        JSON.stringify({
          userId: mockUser.userId,
          email: mockUser.email,
          role: mockUser.role,
          tokenVersion: mockUser.tokenVersion,
        }),
      ); // loginData

    jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(true));
    (authRepository.findUserById as jest.Mock).mockResolvedValue(mockUser);

    const result = await authService.verifyLoginOtp(email, '123456', mockRequestMeta);

    expect(result).toHaveProperty('accessToken');
    expect(result.userId).toBe(mockUser.userId);
  });

  it('TC04 (Pass): verifyLoginOtp should reject expired OTP and throw ValidationError', async () => {
    const redisMock = getRedis();
    // Simulate expired OTP (redis returns null)
    (redisMock.get as jest.Mock).mockResolvedValue(null);

    await expect(authService.verifyLoginOtp(email, '123456', mockRequestMeta)).rejects.toThrow(
      'OTP đã hết hạn hoặc không hợp lệ.',
    );
  });
});
