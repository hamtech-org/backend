import { Router } from 'express';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';
import { validate, validateParams } from '@/shared/middlewares/validate.middleware.js';
import { liveController } from './live.controller.js';
import {
  createLiveSessionBodySchema,
  patchLiveSessionBodySchema,
  sessionIdParamsSchema,
} from './live.validator.js';

const router = Router();

router.use(authenticate);

router.post('/sessions', validate(createLiveSessionBodySchema), liveController.create);
router.get('/sessions', liveController.list);
router.get('/sessions/:sessionId', validateParams(sessionIdParamsSchema), liveController.getById);
router.patch(
  '/sessions/:sessionId',
  validateParams(sessionIdParamsSchema),
  validate(patchLiveSessionBodySchema),
  liveController.patch,
);

router.post('/sessions/:sessionId/end', validateParams(sessionIdParamsSchema), liveController.end);

export default router;
