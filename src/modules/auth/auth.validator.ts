import { z } from 'zod';

const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/;
const passwordMsg = 'Mật khẩu phải có chữ hoa, chữ thường, số và ký tự đặc biệt';

export const registerSchema = z.object({
  email: z.string().email('Email không hợp lệ').max(255),
  password: z
    .string()
    .min(8, 'Mật khẩu tối thiểu 8 ký tự')
    .max(128)
    .regex(passwordRegex, passwordMsg),
  displayName: z.string().min(2, 'Tên tối thiểu 2 ký tự').max(50),
});

export const loginSchema = z.object({
  email: z.string().email('Email không hợp lệ'),
  password: z.string().min(1, 'Mật khẩu không được để trống'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Email không hợp lệ'),
});

export const resetPasswordSchema = z.object({
  email: z.string().email('Email không hợp lệ'),
  token: z.string().min(1, 'OTP không được để trống'),
  newPassword: z
    .string()
    .min(8, 'Mật khẩu tối thiểu 8 ký tự')
    .regex(passwordRegex, passwordMsg),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Mật khẩu hiện tại không được để trống'),
  newPassword: z
    .string()
    .min(8, 'Mật khẩu tối thiểu 8 ký tự')
    .regex(passwordRegex, passwordMsg),
});

export const faceLoginSchema = z.object({
  image: z
    .string()
    .min(1, 'Ảnh khuôn mặt không được để trống')
    .max(7_000_000, 'Ảnh quá lớn (tối đa ~5MB base64)'),
});

export const verifyEmailSchema = z.object({
  email: z.string().email('Email không hợp lệ'),
  otp: z.string().length(6, 'OTP phải có 6 chữ số').regex(/^\d+$/, 'OTP chỉ được chứa chữ số'),
});

export const verifyLoginOtpSchema = z.object({
  email: z.string().email('Email không hợp lệ'),
  otp: z.string().length(6, 'OTP phải có 6 chữ số').regex(/^\d+$/, 'OTP chỉ được chứa chữ số'),
});
