import { Router } from 'express';
import { pollController } from './poll.controller.js';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';

const router = Router();

router.get('/groups/:groupId/polls', authenticate, pollController.getPolls);
router.post('/groups/:groupId/polls', authenticate, pollController.createPoll);
router.post('/groups/:groupId/polls/:pollId/vote', authenticate, pollController.votePoll);
router.post('/groups/:groupId/polls/:pollId/unvote', authenticate, pollController.unvotePoll);
router.post('/groups/:groupId/polls/:pollId/options', authenticate, pollController.addPollOption);
router.post('/groups/:groupId/polls/:pollId/close', authenticate, pollController.closePoll);

export default router;
