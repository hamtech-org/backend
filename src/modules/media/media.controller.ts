import { Request, Response, NextFunction } from 'express';
import { mediaService } from './media.service.js';
import { sendSuccess, sendCreated } from '@/shared/utils/response.js';
import { uploadBodySchema, uploadMultiBodySchema } from './media.validator.js';
import { ValidationError } from '@/shared/utils/errors.js';

function wantsAttachmentDownload(req: Request): boolean {
  const q = req.query.attachment;
  return q === '1' || q === 'true';
}

function resolveDownloadFilename(req: Request, fallback: string): string {
  const raw = typeof req.query.filename === 'string' ? req.query.filename.trim() : '';
  if (!raw) return fallback;
  try {
    const decoded = decodeURIComponent(raw)
      .replace(/[\r\n\0]/g, '')
      .trim();
    return decoded.slice(0, 255) || fallback;
  } catch {
    return fallback;
  }
}

function contentDispositionAttachment(filename: string): string {
  const name = (filename || 'download').trim().replace(/[\r\n\0]/g, '') || 'download';
  const ascii = name.replace(/[^\x20-\x7E]+/g, '_').replace(/["\\]/g, '_') || 'download';
  const encoded = encodeURIComponent(name);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function stripInternalKeys(media: {
  s3Key: string;
  s3ThumbnailKey: string | null;
  mediaId: string;
  uploaderId: string;
  url: string;
  thumbnailUrl: string | null;
  visibility: 'public' | 'private';
  scope: 'chat' | 'general';
  type: string;
  mimeType: string;
  size: number;
  originalName: string;
  createdAt: string;
  updatedAt: string;
}) {
  const { s3Key: _s, s3ThumbnailKey: _t, ...rest } = media;
  void _s;
  void _t;
  return rest;
}

export const mediaController = {
  upload: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      console.log('DEBUG: media/upload body:', req.body);
      console.log(
        'DEBUG: media/upload file:',
        req.file ? { name: req.file.originalname, size: req.file.size } : 'NONE',
      );

      const parsed = uploadBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        const msg = parsed.error.errors.map((e) => e.message).join(', ');
        console.error('DEBUG: Validation failed:', msg);
        next(new ValidationError(msg));
        return;
      }
      const { mediaType, deliveryScope } = parsed.data;
      if (!req.file) {
        next(new ValidationError('Thiếu file upload'));
        return;
      }
      const result = await mediaService.upload(
        req.user!.userId,
        req.file,
        mediaType,
        deliveryScope,
      );
      sendCreated(res, result, 'Upload thành công');
    } catch (error) {
      console.error('DEBUG: Upload catch error:', error);
      next(error);
    }
  },

  uploadMulti: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = uploadMultiBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        next(new ValidationError(parsed.error.errors.map((e) => e.message).join(', ')));
        return;
      }
      const { mediaType, deliveryScope } = parsed.data;
      const files = req.files as Express.Multer.File[] | undefined;
      if (!files?.length) {
        next(new ValidationError('Thiếu file (field: files)'));
        return;
      }
      const results = await mediaService.uploadMulti(
        req.user!.userId,
        files,
        mediaType,
        deliveryScope,
      );
      sendCreated(res, results, 'Upload thành công');
    } catch (error) {
      next(error);
    }
  },

  getMedia: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const media = await mediaService.getMediaById(req.params.mediaId);
      sendSuccess(res, stripInternalKeys(media));
    } catch (error) {
      next(error);
    }
  },

  deleteMedia: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await mediaService.deleteMedia(req.params.mediaId, req.user!.userId);
      sendSuccess(res, null, 'Xóa media thành công');
    } catch (error) {
      next(error);
    }
  },

  download: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!wantsAttachmentDownload(req)) {
        const url = await mediaService.getDownloadUrl(req.params.mediaId);
        res.redirect(302, url);
        return;
      }

      const { stream, contentType, contentLength, originalName } =
        await mediaService.streamMediaForDownload(req.params.mediaId);
      const filename = resolveDownloadFilename(req, originalName);
      res.setHeader('Content-Disposition', contentDispositionAttachment(filename));
      res.setHeader('Content-Type', contentType);
      if (contentLength != null) {
        res.setHeader('Content-Length', String(contentLength));
      }
      res.setHeader('Cache-Control', 'private, no-store');
      stream.on('error', (err) => {
        if (!res.headersSent) {
          next(err);
        } else {
          res.end();
        }
      });
      stream.pipe(res);
    } catch (error) {
      next(error);
    }
  },

  getThumbnail: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const url = await mediaService.getThumbnailUrl(req.params.mediaId);
      res.redirect(302, url);
    } catch (error) {
      next(error);
    }
  },
};
