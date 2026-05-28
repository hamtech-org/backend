import { Router } from 'express';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';
import { validate, validateQuery } from '@/shared/middlewares/validate.middleware.js';
import { communityInviteLimiter } from '@/shared/middlewares/rateLimiter.middleware.js';
import { communityController } from './community.controller.js';
import {
  createCommunitySchema,
  joinCommunitySchema,
  listCommunitiesQuerySchema,
  resolveJoinRequestSchema,
  transferOwnerSchema,
  updateCommunitySchema,
  updateMemberRoleSchema,
  reportCommunitySchema,
  resolvePendingPostSchema,
  listModerationLogsQuerySchema,
  reportCommunityEntitySchema,
  resolveCommunityReportSchema,
  listCommunityReportsQuerySchema,
  communityFeedQuerySchema,
  inviteFriendsSchema,
  updateAutoModSchema,
} from './community.validator.js';

const router = Router();

router.get('/', authenticate, validateQuery(listCommunitiesQuerySchema), communityController.list);
router.post('/', authenticate, validate(createCommunitySchema), communityController.create);
router.get(
  '/feed',
  authenticate,
  validateQuery(communityFeedQuerySchema),
  communityController.feed,
);
router.get('/invites', authenticate, communityController.listInvitations);
router.get('/:groupId', authenticate, communityController.get);
router.put('/:groupId', authenticate, validate(updateCommunitySchema), communityController.update);
router.delete('/:groupId', authenticate, communityController.archive);
router.post(
  '/:groupId/join',
  authenticate,
  validate(joinCommunitySchema),
  communityController.join,
);
router.post('/:groupId/leave', authenticate, communityController.leave);
router.get('/:groupId/members', authenticate, communityController.members);
router.delete('/:groupId/members/:userId', authenticate, communityController.removeMember);
router.put(
  '/:groupId/members/:userId/role',
  authenticate,
  validate(updateMemberRoleSchema),
  communityController.updateMemberRole,
);
router.post(
  '/:groupId/transfer-owner',
  authenticate,
  validate(transferOwnerSchema),
  communityController.transferOwner,
);
router.get('/:groupId/requests', authenticate, communityController.requests);
router.patch(
  '/:groupId/requests/:userId',
  authenticate,
  validate(resolveJoinRequestSchema),
  communityController.resolveRequest,
);
router.get('/:groupId/posts', authenticate, communityController.posts);
router.put('/:groupId/posts/:postId/pin', authenticate, communityController.pinPost);
router.put('/:groupId/posts/:postId/unpin', authenticate, communityController.unpinPost);
router.post(
  '/:groupId/reports',
  authenticate,
  validate(reportCommunityEntitySchema),
  communityController.report,
);

router.get(
  '/:groupId/moderation/reports',
  authenticate,
  validateQuery(listCommunityReportsQuerySchema),
  communityController.listReports,
);
router.post(
  '/:groupId/moderation/reports/resolve',
  authenticate,
  validate(resolveCommunityReportSchema),
  communityController.resolveReport,
);

router.get('/:groupId/moderation/posts', authenticate, communityController.listPendingPosts);
router.post(
  '/:groupId/moderation/posts/:postId/resolve',
  authenticate,
  validate(resolvePendingPostSchema),
  communityController.resolvePendingPost,
);

router.get(
  '/:groupId/moderation/logs',
  authenticate,
  validateQuery(listModerationLogsQuerySchema),
  communityController.listModerationLogs,
);

// Linked Chat Routes
router.post('/:groupId/join-chat', authenticate, communityController.joinChat);
router.delete('/:groupId/link-chat', authenticate, communityController.unlinkChat);

// Community Invitation Routes
router.post(
  '/:groupId/invites',
  authenticate,
  communityInviteLimiter,
  validate(inviteFriendsSchema),
  communityController.invite,
);
router.post('/:groupId/invites/accept', authenticate, communityController.acceptInvite);
router.post('/:groupId/invites/decline', authenticate, communityController.declineInvite);

// Community Invite Link Routes
router.post('/:groupId/invite-link', authenticate, communityController.getInviteLink);
router.delete('/:groupId/invite-link', authenticate, communityController.disableInviteLink);
router.get('/join/:inviteCode', authenticate, communityController.getCommunityByInviteCode);
router.post('/join/:inviteCode/accept', authenticate, communityController.acceptInviteLink);

// Auto-Mod Settings Routes
router.get('/:groupId/automod', authenticate, communityController.getAutoModSettings);
router.put(
  '/:groupId/automod',
  authenticate,
  validate(updateAutoModSchema),
  communityController.updateAutoModSettings,
);

// Analytics Routes
router.get('/:groupId/analytics', authenticate, communityController.getAnalytics);

export default router;
