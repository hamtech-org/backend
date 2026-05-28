import { Router } from 'express';
import { memberRequestController } from './member-request.controller.js';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';

const router = Router();

router.post('/groups/:groupId/request', authenticate, memberRequestController.joinRequest);
router.get('/groups/:groupId/requests', authenticate, memberRequestController.getGroupRequests);
router.post('/groups/:groupId/requests/:userId/approve', authenticate, memberRequestController.approveRequest);
router.post('/groups/:groupId/requests/:userId/reject', authenticate, memberRequestController.rejectRequest);

export default router;
