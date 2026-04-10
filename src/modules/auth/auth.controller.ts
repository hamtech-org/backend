import { Request, Response, NextFunction } from 'express';
import { authService } from './auth.service.js';
import { sendSuccess, sendCreated } from '@/shared/utils/response.js';
import type { IRequestMeta } from './auth.types.js';

/**
 * Extract IP + User-Agent từ request
 */
const getRequestMeta = (req: Request): IRequestMeta => ({
  ipAddress: req.ip || req.socket?.remoteAddress || 'unknown',
  userAgent: req.headers['user-agent'] || 'unknown',
});

export const authController = {
  register: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await authService.register(req.body);
      sendCreated(res, result, 'Đăng ký thành công');
    } catch (error) {
      next(error);
    }
  },

  login: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await authService.login(req.body);
      sendSuccess(res, result, 'Đăng nhập thành công');
    } catch (error) {
      next(error);
    }
  },

  refreshToken: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { refreshToken } = req.body as { refreshToken: string };
      const result = await authService.refreshToken(refreshToken);
      sendSuccess(res, result, 'Token đã được làm mới');
    } catch (error) {
      next(error);
    }
  },

  logout: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await authService.logout(req.user!.userId, req.user!.sessionId);
      sendSuccess(res, null, 'Đăng xuất thành công');
    } catch (error) {
      next(error);
    }
  },

  logoutAll: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await authService.logoutAll(req.user!.userId);
      sendSuccess(res, null, 'Đã đăng xuất tất cả thiết bị');
    } catch (error) {
      next(error);
    }
  },

  forgotPassword: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email } = req.body as { email: string };
      await authService.forgotPassword(email);
      sendSuccess(res, null, 'Nếu email tồn tại, OTP đã được gửi');
    } catch (error) {
      next(error);
    }
  },

  verifyEmail: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, otp } = req.body as { email: string; otp: string };
      const result = await authService.verifyEmail(email, otp, getRequestMeta(req));
      sendSuccess(res, result, 'Email đã được xác thực thành công');
    } catch (error) {
      next(error);
    }
  },

  verifyLoginOtp: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, otp } = req.body as { email: string; otp: string };
      const result = await authService.verifyLoginOtp(email, otp, getRequestMeta(req));
      sendSuccess(res, result, 'Đăng nhập thành công');
    } catch (error) {
      next(error);
    }
  },

  resetPassword: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, token, newPassword } = req.body as {
        email: string;
        token: string;
        newPassword: string;
      };
      await authService.resetPassword(email, token, newPassword);
      sendSuccess(res, null, 'Đặt lại mật khẩu thành công');
    } catch (error) {
      next(error);
    }
  },

  changePassword: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { currentPassword, newPassword } = req.body as {
        currentPassword: string;
        newPassword: string;
      };
      await authService.changePassword(req.user!.userId, currentPassword, newPassword);
      sendSuccess(res, null, 'Đổi mật khẩu thành công');
    } catch (error) {
      next(error);
    }
  },

  // ── Face Login ──

  enableFaceLogin: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { image } = req.body as { image: string };
      await authService.enableFaceLogin(req.user!.userId, image);
      sendSuccess(res, null, 'Đã bật đăng nhập bằng khuôn mặt');
    } catch (error) {
      next(error);
    }
  },

  disableFaceLogin: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await authService.disableFaceLogin(req.user!.userId);
      sendSuccess(res, null, 'Đã tắt đăng nhập bằng khuôn mặt');
    } catch (error) {
      next(error);
    }
  },

  loginWithFace: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { image } = req.body as { image: string };
      const result = await authService.loginWithFace(image, getRequestMeta(req));
      sendSuccess(res, result, 'Đăng nhập bằng khuôn mặt thành công');
    } catch (error) {
      next(error);
    }
  },
};
