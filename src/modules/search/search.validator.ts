import { z } from 'zod';

const positiveInt = z.coerce.number().int().positive();

/**
 * Query chung cho các endpoint GET /api/:version/search/*
 * Khớp với frontend: `q`, tuỳ chọn `page`, `pageSize`, `sortBy`, `sortOrder`.
 */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(1, 'Thiếu hoặc rỗng tham số q (từ khóa tìm kiếm)'),
  page: positiveInt.optional(),
  pageSize: positiveInt.max(100).optional(),
  sortBy: z.string().max(64).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});
