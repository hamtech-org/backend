import { Router } from 'express';
import { groupJoinController } from './group.join.controller.js';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';
import { authenticateOptional } from '@/shared/middlewares/auth-optional.middleware.js';
import { validateParams } from '@/shared/middlewares/validate.middleware.js';
import { joinLinkSuffixParamSchema } from './group.join.validator.js';

const router = Router();

router.get(
  '/join/:suffix/preview',
  authenticateOptional,
  validateParams(joinLinkSuffixParamSchema),
  groupJoinController.getJoinPreview,
);

router.post(
  '/join/:suffix',
  authenticate,
  validateParams(joinLinkSuffixParamSchema),
  groupJoinController.joinViaLink,
);

export default router;
