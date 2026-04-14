import { Router } from 'express';
import { mediaController } from './media.controller.js';
import { authenticate } from '@/shared/middlewares/auth.middleware.js';
import { uploadLimiter } from '@/shared/middlewares/rateLimiter.middleware.js';
import { uploadSingleMiddleware, uploadMultiMiddleware } from './media.multer.js';

const router = Router();

router.post(
  '/upload',
  authenticate,
  uploadLimiter,
  uploadSingleMiddleware,
  mediaController.upload,
);
router.post(
  '/upload/multi',
  authenticate,
  uploadLimiter,
  uploadMultiMiddleware,
  mediaController.uploadMulti,
);
router.get('/:mediaId', authenticate, mediaController.getMedia);
router.delete('/:mediaId', authenticate, mediaController.deleteMedia);
router.get('/:mediaId/download', authenticate, mediaController.download);
router.get('/:mediaId/thumbnail', authenticate, mediaController.getThumbnail);

export default router;
