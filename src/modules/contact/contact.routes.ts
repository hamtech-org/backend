import { Router } from 'express';
import { contactController } from './contact.controller.js';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';
import { validate } from '@/shared/middlewares/validate.middleware.js';
import { createGroupSchema } from './contact.validator.js';

const router = Router();

router.get('/friends', authenticate, contactController.getFriends);
router.delete('/friends/:friendId', authenticate, contactController.removeFriend);
router.get('/groups', authenticate, contactController.getGroups);
router.post('/groups', authenticate, validate(createGroupSchema), contactController.createGroup);

export default router;
