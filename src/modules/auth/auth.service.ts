import { authRepository } from './auth.repository.js';
import type { IRegisterDto, ILoginDto, ILoginResponse } from './auth.types.js';

export const authService = {
  register: async (_data: IRegisterDto): Promise<ILoginResponse> => {
    // TODO: Kiểm tra email trùng, hash password, tạo user, tạo tokens
    void _data;
    throw new Error('Chưa triển khai');
  },

  login: async (_data: ILoginDto): Promise<ILoginResponse> => {
    // TODO: Tìm user theo email, so sánh password, tạo tokens
    void _data;
    void authRepository;
    throw new Error('Chưa triển khai');
  },

  refreshToken: async (_refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> => {
    // TODO: Verify refresh token, tạo access token mới
    throw new Error('Chưa triển khai');
  },

  logout: async (_userId: string, _sessionId: string): Promise<void> => {
    // TODO: Xóa session
    throw new Error('Chưa triển khai');
  },

  forgotPassword: async (_email: string): Promise<void> => {
    // TODO: Tạo OTP, gửi email reset qua SES
    throw new Error('Chưa triển khai');
  },

  resetPassword: async (_token: string, _newPassword: string): Promise<void> => {
    // TODO: Verify OTP, cập nhật password
    throw new Error('Chưa triển khai');
  },

  changePassword: async (_userId: string, _currentPassword: string, _newPassword: string): Promise<void> => {
    // TODO: Verify current password, update new password
    throw new Error('Chưa triển khai');
  },
};
