import { mediaRepository } from './media.repository.js';
import type { IMedia, IUploadResult, MediaType } from './media.types.js';
import { NotFoundError } from '@/shared/utils/errors.js';

export const mediaService = {
  upload: async (_uploaderId: string, _file: Express.Multer.File, _mediaType: MediaType): Promise<IUploadResult> => {
    // TODO: Upload file lên S3, tạo thumbnail bằng sharp, lưu metadata vào DynamoDB
    void mediaRepository;
    throw new Error('Chưa triển khai');
  },

  uploadMulti: async (_uploaderId: string, _files: Express.Multer.File[], _mediaType: MediaType): Promise<IUploadResult[]> => {
    // TODO: Upload nhiều file song song
    throw new Error('Chưa triển khai');
  },

  getMediaById: async (mediaId: string): Promise<IMedia> => {
    const media = await mediaRepository.findById(mediaId);
    if (!media) throw new NotFoundError('Media');
    return media;
  },

  deleteMedia: async (mediaId: string, _uploaderId: string): Promise<void> => {
    // TODO: Xóa file trên S3 + xóa record trong DynamoDB
    await mediaRepository.delete(mediaId);
  },

  getDownloadUrl: async (_mediaId: string): Promise<string> => {
    // TODO: Tạo pre-signed URL cho S3
    throw new Error('Chưa triển khai');
  },

  getThumbnailUrl: async (_mediaId: string): Promise<string> => {
    // TODO: Trả về thumbnail URL
    throw new Error('Chưa triển khai');
  },
};
