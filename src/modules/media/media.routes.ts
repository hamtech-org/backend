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
/**
 * NOTE:
 * - `img src` / `<video src>` không tự gửi Authorization header.
 * - Nếu protect download/thumbnail bằng `authenticate` thì avatar nhóm, ảnh trong chat sẽ 401 khi render.
 * - Vẫn an toàn vì endpoint này chỉ redirect sang signed S3 URL (hết hạn nhanh).
 *
 * Giữ nguyên các route có auth (GET meta, DELETE) — chỉ mở download/thumbnail.
 */
router.get('/:mediaId/download', mediaController.download);
router.get('/:mediaId/thumbnail', mediaController.getThumbnail);

export default router;
