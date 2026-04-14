import { Router } from 'express';
import { userController } from './user.controller.js';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';
import { validate } from '@/shared/middlewares/validate.middleware.js';
import { updateProfileSchema, friendIdParamSchema } from './user.validator.js';

const router = Router();

// ── Protected routes (cần auth) ──
router.get('/me', authenticate, userController.getProfile);
router.put('/me', authenticate, validate(updateProfileSchema), userController.updateProfile);
router.get('/search', authenticate, userController.searchUsers);
router.post('/multiple', authenticate, userController.getMultipleUsers);
router.get('/:userId', authenticate, userController.getUserById);

// ── Friend Request routes ──
// Send friend request
router.post('/friends/:friendId', authenticate, userController.sendFriendRequest);

// Accept friend request
router.post('/friends/:senderId/accept', authenticate, userController.acceptFriendRequest);

// Reject friend request
router.post('/friends/:senderId/reject', authenticate, userController.rejectFriendRequest);

// Cancel sent friend request
router.post('/friends/:receiverId/cancel', authenticate, userController.cancelFriendRequest);

// Get pending requests (both received and sent)
router.get('/friends/requests/pending', authenticate, userController.getPendingRequests);

// Get suggested friends
router.get('/friends/suggestions', authenticate, userController.getSuggestedFriends);
router.get('/friends/:userId/status', authenticate, userController.getFriendRequestStatus);

// Remove/unfriend
router.delete('/friends/:friendId', authenticate, userController.removeFriend);

// Get friends list
router.get('/friends', authenticate, userController.getFriends);

export default router;
