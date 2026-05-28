import type { PaginationOptions, PaginationMeta } from '@/shared/types/common.types.js';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export const parsePaginationOptions = (query: Record<string, unknown>): PaginationOptions => {
  const page = Math.max(Number(query.page) || DEFAULT_PAGE, 1);
  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const sort = (query.sort as string) || 'createdAt';
  const order = (query.order as 'asc' | 'desc') || 'desc';

  return { page, limit, sort, order };
};

export const buildPaginationMeta = (
  page: number,
  limit: number,
  total: number,
): PaginationMeta => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
});
