import { z } from 'zod';

const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/;
const passwordMsg = 'Mật khẩu phải có chữ hoa, chữ thường, số và ký tự đặc biệt';

export const adminListQuerySchema = z.object({
  query: z.string().max(200).optional(),
  role: z.enum(['admin', 'user']).optional(),
  status: z.string().max(32).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(500).optional(),
});

export const createAdminUserSchema = z.object({
  email: z.string().email('Email không hợp lệ').max(255),
  password: z
    .string()
    .min(8, 'Mật khẩu tối thiểu 8 ký tự')
    .max(128)
    .regex(passwordRegex, passwordMsg),
  displayName: z.string().min(2, 'Tên tối thiểu 2 ký tự').max(50),
  role: z.enum(['admin', 'user']).optional(),
});

export const updateAdminUserSchema = z
  .object({
    displayName: z.string().min(2).max(50).optional(),
    email: z.string().email().max(255).optional(),
    avatar: z.string().url().nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Cần ít nhất một trường cập nhật' });

export const updateAdminUserRoleSchema = z.object({
  role: z.enum(['admin', 'user']),
});

export const createAdminGroupSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  ownerId: z.string().min(1),
  memberIds: z.array(z.string().min(1)).optional(),
});

export const updateAdminGroupSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    avatar: z.string().url().optional(),
    status: z.enum(['active', 'locked', 'archived']).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Cần ít nhất một trường cập nhật' });

export const createAdminPostSchema = z.object({
  content: z.string().min(1).max(10000),
  visibility: z.enum(['public', 'friends', 'private']).optional(),
  status: z.enum(['visible', 'hidden', 'flagged']).optional(),
});

export const updateAdminPostSchema = z
  .object({
    content: z.string().min(1).max(10000).optional(),
    visibility: z.enum(['public', 'friends', 'private']).optional(),
    status: z.enum(['visible', 'hidden', 'flagged']).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Cần ít nhất một trường cập nhật' });

export const analyticsDashboardQuerySchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
    interval: z.enum(['hour', 'day', 'week', 'month']).optional(),
  })
  .superRefine((q, ctx) => {
    const MS_PER_DAY = 86_400_000;
    const ANALYTICS_MAX_RANGE_DAYS = 90;
    if (q.from && q.to) {
      const fromMs = new Date(q.from).getTime();
      const toMs = new Date(q.to).getTime();
      if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'from hoặc to không phải ngày hợp lệ',
        });
        return;
      }
      if (toMs < fromMs) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'to phải sau hoặc bằng from',
          path: ['to'],
        });
      }
      const days = (toMs - fromMs) / MS_PER_DAY;
      if (days > ANALYTICS_MAX_RANGE_DAYS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Khoảng thời gian tối đa ${ANALYTICS_MAX_RANGE_DAYS} ngày`,
          path: ['to'],
        });
      }
    }
  });
