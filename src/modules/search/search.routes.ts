import { Router } from 'express';
import { searchController } from './search.controller.js';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';

const router = Router();

router.get('/messages', authenticate, searchController.searchMessages);
router.get('/users', authenticate, searchController.searchUsers);
router.get('/users/by-contact', authenticate, searchController.searchUsersByContact);
router.get('/groups', authenticate, searchController.searchGroups);
router.get('/posts', authenticate, searchController.searchPosts);
router.get('/all', authenticate, searchController.searchAll);
router.get('/all-chat', authenticate, searchController.searchAllChat);

export default router;
