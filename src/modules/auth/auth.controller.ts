import { Request, Response, NextFunction } from 'express';
import { authService } from './auth.service.js';
import { sendSuccess, sendCreated } from '@/shared/utils/response.js';

export const authController = {
  register: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await authService.register(req.body);
      sendCreated(res, result, 'Đăng ký thành công');
    } catch (error) { next(error); }
  },

  login: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await authService.login(req.body);
      sendSuccess(res, result, 'Đăng nhập thành công');
    } catch (error) { next(error); }
  },

  refreshToken: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { refreshToken } = req.body as { refreshToken: string };
      const result = await authService.refreshToken(refreshToken);
      sendSuccess(res, result);
    } catch (error) { next(error); }
  },

  logout: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await authService.logout(req.user!.userId, '');
      sendSuccess(res, null, 'Đăng xuất thành công');
    } catch (error) { next(error); }
  },

  forgotPassword: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email } = req.body as { email: string };
      await authService.forgotPassword(email);
      sendSuccess(res, null, 'Email reset password đã được gửi');
    } catch (error) { next(error); }
  },

  resetPassword: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token, newPassword } = req.body as { token: string; newPassword: string };
      await authService.resetPassword(token, newPassword);
      sendSuccess(res, null, 'Đặt lại mật khẩu thành công');
    } catch (error) { next(error); }
  },

  changePassword: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
      await authService.changePassword(req.user!.userId, currentPassword, newPassword);
      sendSuccess(res, null, 'Đổi mật khẩu thành công');
    } catch (error) { next(error); }
  },
};
