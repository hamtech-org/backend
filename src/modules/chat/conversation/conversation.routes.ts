import { Router } from 'express';
import { conversationController } from './conversation.controller.js';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';
import { validate } from '@/shared/middlewares/validate.middleware.js';
import {
  createConversationSchema,
  updateConversationPreferencesSchema,
} from './conversation.validator.js';

const router = Router();

router.get(
  '/conversations',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  (req, res, next) => {
    void conversationController.getConversations(req, res, next);
  },
);
router.post(
  '/conversations',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  validate(createConversationSchema),
  (req, res, next) => {
    void conversationController.createConversation(req, res, next);
  },
);
router.get(
  '/conversations/:conversationId',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  (req, res, next) => {
    void conversationController.getConversation(req, res, next);
  },
);
router.get(
  '/conversations/:conversationId/members',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  (req, res, next) => {
    void conversationController.getConversationMembers(req, res, next);
  },
);
router.get('/conversations/:conversationId/avatar', (req, res, next) => {
  void conversationController.getConversationAvatar(req, res, next);
});
router.patch(
  '/conversations/:conversationId/preferences',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  validate(updateConversationPreferencesSchema),
  (req, res, next) => {
    void conversationController.patchPreferences(req, res, next);
  },
);

router.delete(
  '/conversations/:conversationId',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  (req, res, next) => {
    void conversationController.deleteConversation(req, res, next);
  },
);

export default router;
