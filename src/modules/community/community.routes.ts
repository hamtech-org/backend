import { Router } from 'express';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';
import { validate, validateQuery } from '@/shared/middlewares/validate.middleware.js';
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
} from './community.validator.js';

const router = Router();

router.get('/', authenticate, validateQuery(listCommunitiesQuerySchema), communityController.list);
router.post('/', authenticate, validate(createCommunitySchema), communityController.create);
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
  validate(reportCommunitySchema),
  communityController.report,
);

export default router;
