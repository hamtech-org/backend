import { Router } from 'express';
import { groupController } from './group.controller.js';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';
import { validate } from '@/shared/middlewares/validate.middleware.js';
import {
  updateGroupSchema,
  addMembersSchema,
  changeRoleSchema,
  updateGroupSettingsSchema,
  leaveGroupSchema,
} from './group.validator';

const router = Router();

router.get('/groups/:groupId/members', authenticate, groupController.getGroupMembers);
router.get('/groups/:groupId/settings', authenticate, groupController.getGroupSettings);
router.patch(
  '/groups/:groupId/settings',
  authenticate,
  validate(updateGroupSettingsSchema),
  groupController.updateGroupSettings,
);
router.put(
  '/groups/:groupId',
  authenticate,
  validate(updateGroupSchema),
  groupController.updateGroup,
);
router.delete('/groups/:groupId', authenticate, groupController.deleteGroup);
router.post(
  '/groups/:groupId/leave',
  authenticate,
  validate(leaveGroupSchema),
  groupController.leaveGroup,
);
router.post(
  '/groups/:groupId/members',
  authenticate,
  validate(addMembersSchema),
  groupController.addMembers,
);
router.delete('/groups/:groupId/members/:userId', authenticate, groupController.removeMember);
router.put(
  '/groups/:groupId/members/:userId/role',
  authenticate,
  validate(changeRoleSchema),
  groupController.changeMemberRole,
);

export default router;
