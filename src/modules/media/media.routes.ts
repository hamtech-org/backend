import { Router } from 'express';
import { mediaController } from './media.controller.js';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';
import { validate } from '@/shared/middlewares/validate.middleware.js';
import { uploadSchema } from './media.validator.js';

const router = Router();

router.post('/upload', authenticate, validate(uploadSchema), mediaController.upload);
router.post('/upload/multi', authenticate, mediaController.uploadMulti);
router.get('/:mediaId', authenticate, mediaController.getMedia);
router.delete('/:mediaId', authenticate, mediaController.deleteMedia);
router.get('/:mediaId/download', authenticate, mediaController.download);
router.get('/:mediaId/thumbnail', authenticate, mediaController.getThumbnail);

export default router;
