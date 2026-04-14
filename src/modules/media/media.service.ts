import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { mediaRepository } from './media.repository.js';
import type { AllowedMimeType, IMedia, IUploadResult, MediaType } from './media.types.js';
import { assertValidUploadBuffer, assertValidUploadBufferAuto } from './media.validation.js';
import { NotFoundError, ForbiddenError } from '@/shared/utils/errors.js';
import { env } from '@/config/env.js';
import { deleteObjectKey, getSignedGetUrl, putObject } from '@/shared/services/s3Media.service.js';

const API_BASE_PATH = `/api/${env.API_VERSION}/media`;

export function buildMediaDownloadUrl(mediaId: string): string {
  return `${env.API_PUBLIC_ORIGIN}${API_BASE_PATH}/${mediaId}/download`;
}

export function buildMediaThumbnailUrl(mediaId: string): string {
  return `${env.API_PUBLIC_ORIGIN}${API_BASE_PATH}/${mediaId}/thumbnail`;
}

function s3OriginalKey(uploaderId: string, mediaId: string, ext: string): string {
  return `uploads/${uploaderId}/${mediaId}/original${ext}`;
}

function s3ThumbKey(uploaderId: string, mediaId: string): string {
  return `uploads/${uploaderId}/${mediaId}/thumb.jpg`;
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/heic': '.heic',
    'image/heif': '.heif',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'audio/mpeg': '.mp3',
    'audio/ogg': '.ogg',
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/zip': '.zip',
    'application/x-zip-compressed': '.zip',
    'application/vnd.rar': '.rar',
    'application/x-rar-compressed': '.rar',
  };
  return map[mime] ?? '.bin';
}

async function maybeThumbnailBuffer(
  declaredType: MediaType,
  mime: string,
  buffer: Buffer,
): Promise<Buffer | null> {
  if (declaredType !== 'image') return null;
  if (!mime.startsWith('image/')) return null;
  try {
    return await sharp(buffer)
      .rotate()
      .resize(400, 400, { fit: 'inside' })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch {
    return null;
  }
}

type ProcessMediaMode = MediaType | 'auto';

async function processOneFile(
  uploaderId: string,
  file: Express.Multer.File,
  mediaTypeOrAuto: ProcessMediaMode,
): Promise<IUploadResult> {
  const buffer = file.buffer;
  let mimeType: AllowedMimeType;
  let size: number;
  let mediaType: MediaType;

  if (mediaTypeOrAuto === 'auto') {
    const r = await assertValidUploadBufferAuto(buffer, file.originalname);
    mimeType = r.mimeType;
    size = r.size;
    mediaType = r.mediaType;
  } else {
    const r = await assertValidUploadBuffer(buffer, file.originalname, mediaTypeOrAuto);
    mimeType = r.mimeType;
    size = r.size;
    mediaType = mediaTypeOrAuto;
  }

  const mediaId = uuidv4();
  const ext = extFromMime(mimeType);
  const origKey = s3OriginalKey(uploaderId, mediaId, ext);
  const thumbKey = s3ThumbKey(uploaderId, mediaId);

  await putObject({
    key: origKey,
    body: buffer,
    contentType: mimeType,
  });

  let s3ThumbnailKey: string | null = null;
  let thumbnailUrl: string | null = null;
  const thumbBuf = await maybeThumbnailBuffer(mediaType, mimeType, buffer);
  if (thumbBuf) {
    await putObject({
      key: thumbKey,
      body: thumbBuf,
      contentType: 'image/jpeg',
    });
    s3ThumbnailKey = thumbKey;
    thumbnailUrl = buildMediaThumbnailUrl(mediaId);
  }

  const now = new Date().toISOString();
  const downloadUrl = buildMediaDownloadUrl(mediaId);

  const record: IMedia = {
    mediaId,
    uploaderId,
    url: downloadUrl,
    thumbnailUrl,
    s3Key: origKey,
    s3ThumbnailKey,
    type: mediaType,
    mimeType,
    size,
    originalName: file.originalname,
    createdAt: now,
    updatedAt: now,
  };

  await mediaRepository.create(record);

  return {
    mediaId,
    url: downloadUrl,
    thumbnailUrl,
    type: mediaType,
    size,
    mimeType,
  };
}

export const mediaService = {
  upload: async (
    uploaderId: string,
    file: Express.Multer.File,
    mediaType: MediaType,
  ): Promise<IUploadResult> => {
    return processOneFile(uploaderId, file, mediaType);
  },

  uploadMulti: async (
    uploaderId: string,
    files: Express.Multer.File[],
    mediaType?: MediaType,
  ): Promise<IUploadResult[]> => {
    const mode: ProcessMediaMode = mediaType ?? 'auto';
    const concurrency = 4;
    const results: IUploadResult[] = [];
    for (let i = 0; i < files.length; i += concurrency) {
      const chunk = files.slice(i, i + concurrency);
      const part = await Promise.all(chunk.map((f) => processOneFile(uploaderId, f, mode)));
      results.push(...part);
    }
    return results;
  },

  getMediaById: async (mediaId: string): Promise<IMedia> => {
    const media = await mediaRepository.findById(mediaId);
    if (!media) throw new NotFoundError('Media');
    return media;
  },

  getMediaForMessageAttach: async (
    mediaId: string,
    senderId: string,
  ): Promise<{
    mediaUrl: string;
    mediaType: string;
    mediaSize: number;
    thumbnailUrl: string | null;
    originalName: string;
  }> => {
    const media = await mediaRepository.findById(mediaId);
    if (!media) throw new NotFoundError('Media');
    if (media.uploaderId !== senderId) {
      throw new ForbiddenError('Không được dùng media của người khác');
    }
    return {
      mediaUrl: media.url,
      mediaType: media.mimeType,
      mediaSize: media.size,
      thumbnailUrl: media.thumbnailUrl,
      originalName: media.originalName,
    };
  },

  deleteMedia: async (mediaId: string, userId: string): Promise<void> => {
    const media = await mediaRepository.findById(mediaId);
    if (!media) throw new NotFoundError('Media');
    if (media.uploaderId !== userId) {
      throw new ForbiddenError('Chỉ người upload mới được xóa media');
    }
    await deleteObjectKey(media.s3Key);
    if (media.s3ThumbnailKey) {
      await deleteObjectKey(media.s3ThumbnailKey);
    }
    await mediaRepository.delete(mediaId);
  },

  getDownloadUrl: async (mediaId: string): Promise<string> => {
    const media = await mediaRepository.findById(mediaId);
    if (!media) throw new NotFoundError('Media');
    return getSignedGetUrl(media.s3Key);
  },

  getThumbnailUrl: async (mediaId: string): Promise<string> => {
    const media = await mediaRepository.findById(mediaId);
    if (!media) throw new NotFoundError('Media');
    if (!media.s3ThumbnailKey) {
      return getSignedGetUrl(media.s3Key);
    }
    return getSignedGetUrl(media.s3ThumbnailKey);
  },
};
