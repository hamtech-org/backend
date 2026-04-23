import { Router } from 'express';
import { searchController } from './search.controller.js';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';
import { validateQuery } from '@/shared/middlewares/validate.middleware.js';
import { searchQuerySchema } from './search.validator.js';

const router = Router();

/** Toàn bộ search yêu cầu đăng nhập — khớp axios + Bearer từ frontend. */
router.use(authenticate);

const q = validateQuery(searchQuerySchema);

/**
 * Base: GET /api/:version/search/...
 * Khớp `frontend/src/services/search.service.ts` (apiClient baseURL /api/v1).
 */
// Đặt path cụ thể trước path ngắn hơn (tránh xung đột nếu sau này thêm /users/:id).
router.get('/users/by-contact', q, searchController.searchUsersByContact);
router.get('/users', q, searchController.searchUsers);
router.get('/groups', q, searchController.searchGroups);
router.get('/posts', q, searchController.searchPosts);
router.get('/messages', q, searchController.searchMessages);
router.get('/all', q, searchController.searchAll);
router.get('/all-chat', q, searchController.searchAllChat);

export default router;
