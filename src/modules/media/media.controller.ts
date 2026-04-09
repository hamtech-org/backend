import { Request, Response, NextFunction } from 'express';
import { mediaService } from './media.service.js';
import { sendSuccess, sendCreated } from '@/shared/utils/response.js';
import type { MediaType } from './media.types.js';

export const mediaController = {
  upload: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { mediaType } = req.body as { mediaType: MediaType };
      const result = await mediaService.upload(req.user!.userId, req.file!, mediaType);
      sendCreated(res, result, 'Upload thành công');
    } catch (error) { next(error); }
  },

  uploadMulti: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { mediaType } = req.body as { mediaType: MediaType };
      const files = req.files as Express.Multer.File[];
      const results = await mediaService.uploadMulti(req.user!.userId, files, mediaType);
      sendCreated(res, results, 'Upload thành công');
    } catch (error) { next(error); }
  },

  getMedia: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const media = await mediaService.getMediaById(req.params.mediaId);
      sendSuccess(res, media);
    } catch (error) { next(error); }
  },

  deleteMedia: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await mediaService.deleteMedia(req.params.mediaId, req.user!.userId);
      sendSuccess(res, null, 'Xóa media thành công');
    } catch (error) { next(error); }
  },

  download: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const url = await mediaService.getDownloadUrl(req.params.mediaId);
      res.redirect(url);
    } catch (error) { next(error); }
  },

  getThumbnail: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const url = await mediaService.getThumbnailUrl(req.params.mediaId);
      res.redirect(url);
    } catch (error) { next(error); }
  },
};
