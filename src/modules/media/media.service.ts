import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import { mediaRepository } from './media.repository.js';
import type {
  AllowedMimeType,
  IMedia,
  IUploadResult,
  MediaDeliveryScope,
  MediaType,
  MediaVisibility,
} from './media.types.js';

/** Trích mediaId từ URL download app: `.../api/v{n}/media/{uuid}/download` (origin tùy). */
function parseMediaIdFromAppDownloadUrl(urlStr: string): string | null {
  const trimmed = (urlStr ?? '').trim();
  if (!trimmed) return null;
  try {
    const u = /^https?:\/\//i.test(trimmed)
      ? new URL(trimmed)
      : new URL(trimmed, 'http://local.invalid');
    const path = u.pathname.replace(/\/+$/, '');
    const m = path.match(
      /\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/download$/i,
    );
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Trích mediaId từ URL object CloudFront/S3 theo key pattern `<scope>/<uploaderId>/<mediaId>/original.ext`. */
function parseMediaIdFromObjectUrl(urlStr: string): string | null {
  const trimmed = (urlStr ?? '').trim();
  if (!trimmed) return null;
  try {
    const u = /^https?:\/\//i.test(trimmed)
      ? new URL(trimmed)
      : new URL(trimmed, 'http://local.invalid');
    const path = u.pathname.replace(/\/+$/, '');
    const m = path.match(
      /\/(?:chat|public)\/[^/]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(?:original|thumb)\b/i,
    );
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}
import { assertValidUploadBuffer, assertValidUploadBufferAuto } from './media.validation.js';
import { NotFoundError, ForbiddenError } from '@/shared/utils/errors.js';
import { env } from '@/config/env.js';
import {
  deleteObjectKey,
  getObjectStream,
  getSignedGetUrl,
  putObject,
} from '@/shared/services/s3Media.service.js';
import {
  buildPrivateCdnUrl,
  buildPublicCdnUrl,
  signPrivateCdnUrl,
} from '@/shared/services/cloudfrontSigner.service.js';

const API_BASE_PATH = `/api/${env.API_VERSION}/media`;

export function buildMediaDownloadUrl(mediaId: string): string {
  return `${env.API_PUBLIC_ORIGIN}${API_BASE_PATH}/${mediaId}/download`;
}

export function buildMediaThumbnailUrl(mediaId: string): string {
  return `${env.API_PUBLIC_ORIGIN}${API_BASE_PATH}/${mediaId}/thumbnail`;
}

function scopePrefix(scope: MediaDeliveryScope): string {
  return scope === 'chat' ? 'chat' : 'public';
}

function s3OriginalKey(
  uploaderId: string,
  mediaId: string,
  ext: string,
  scope: MediaDeliveryScope,
): string {
  return `${scopePrefix(scope)}/${uploaderId}/${mediaId}/original${ext}`;
}

function s3ThumbKey(uploaderId: string, mediaId: string, scope: MediaDeliveryScope): string {
  return `${scopePrefix(scope)}/${uploaderId}/${mediaId}/thumb.jpg`;
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

function inferVisibility(scope: MediaDeliveryScope): MediaVisibility {
  return scope === 'chat' ? 'private' : 'public';
}

function resolveDeliveryUrls(
  media: Pick<
    IMedia,
    'mediaId' | 's3Key' | 's3ThumbnailKey' | 'visibility' | 'url' | 'thumbnailUrl'
  >,
): {
  mediaUrl: string;
  thumbnailUrl: string | null;
} {
  // Legacy records (without visibility) keep existing URL strategy.
  if (!media.visibility) {
    return {
      mediaUrl: media.url || buildMediaDownloadUrl(media.mediaId),
      thumbnailUrl:
        media.thumbnailUrl ?? (media.s3ThumbnailKey ? buildMediaThumbnailUrl(media.mediaId) : null),
    };
  }

  if (media.visibility === 'private') {
    return {
      mediaUrl: signPrivateCdnUrl(media.s3Key),
      thumbnailUrl: media.s3ThumbnailKey ? signPrivateCdnUrl(media.s3ThumbnailKey) : null,
    };
  }

  const fallbackMedia = buildMediaDownloadUrl(media.mediaId);
  const fallbackThumb = buildMediaThumbnailUrl(media.mediaId);
  return {
    mediaUrl: buildPublicCdnUrl(media.s3Key) || fallbackMedia,
    thumbnailUrl: media.s3ThumbnailKey
      ? buildPublicCdnUrl(media.s3ThumbnailKey) || fallbackThumb
      : null,
  };
}

async function processOneFile(
  uploaderId: string,
  file: Express.Multer.File,
  mediaTypeOrAuto: ProcessMediaMode,
  scope: MediaDeliveryScope,
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
  const origKey = s3OriginalKey(uploaderId, mediaId, ext, scope);
  const thumbKey = s3ThumbKey(uploaderId, mediaId, scope);
  const visibility = inferVisibility(scope);

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
  const privateRawUrl = buildPrivateCdnUrl(origKey);
  const publicRawUrl = buildPublicCdnUrl(origKey);
  const downloadUrl =
    visibility === 'private'
      ? privateRawUrl || buildMediaDownloadUrl(mediaId)
      : publicRawUrl || buildMediaDownloadUrl(mediaId);

  const record: IMedia = {
    mediaId,
    uploaderId,
    url: downloadUrl,
    thumbnailUrl:
      visibility === 'private'
        ? s3ThumbnailKey
          ? buildPrivateCdnUrl(thumbKey)
          : null
        : s3ThumbnailKey
          ? buildPublicCdnUrl(thumbKey)
          : null,
    visibility,
    scope,
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
  const delivery = resolveDeliveryUrls(record);

  return {
    mediaId,
    url: delivery.mediaUrl,
    thumbnailUrl: delivery.thumbnailUrl,
    visibility,
    scope,
    type: mediaType,
    size,
    mimeType,
  };
}

async function withTempFile<T>(
  buffer: Buffer,
  ext: string,
  fn: (filePath: string) => Promise<T>,
): Promise<T> {
  const tmpPath = path.join(os.tmpdir(), `zalo-${uuidv4()}${ext}`);
  await fs.writeFile(tmpPath, buffer);
  try {
    return await fn(tmpPath);
  } finally {
    fs.unlink(tmpPath).catch(() => {});
  }
}

export interface VideoProbeResult {
  durationMs: number;
  width: number;
  height: number;
  codec: string | null;
  bitrate: number | null;
}

export async function videoProbe(buffer: Buffer, mime: string): Promise<VideoProbeResult> {
  const ext = mime === 'video/webm' ? '.webm' : mime === 'video/quicktime' ? '.mov' : '.mp4';
  return withTempFile(
    buffer,
    ext,
    (filePath) =>
      new Promise<VideoProbeResult>((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, data) => {
          if (err) return reject(err);
          const stream = data.streams.find((s) => s.codec_type === 'video');
          if (!stream) return reject(new Error('No video stream found'));
          const durationSec = Number(data.format.duration ?? stream.duration ?? 0);
          resolve({
            durationMs: Math.round(durationSec * 1000),
            width: Number(stream.width ?? 0),
            height: Number(stream.height ?? 0),
            codec: stream.codec_name ?? null,
            bitrate: data.format.bit_rate ? Number(data.format.bit_rate) : null,
          });
        });
      }),
  );
}

export async function extractVideoThumbnail(buffer: Buffer, mime: string): Promise<Buffer> {
  const ext = mime === 'video/webm' ? '.webm' : mime === 'video/quicktime' ? '.mov' : '.mp4';
  return withTempFile(buffer, ext, async (inPath) => {
    const outPath = path.join(os.tmpdir(), `zalo-thumb-${uuidv4()}.jpg`);
    try {
      await new Promise<void>((resolve, reject) => {
        ffmpeg(inPath)
          .on('error', reject)
          .on('end', () => resolve())
          .screenshots({
            timestamps: ['00:00:01.000'],
            filename: path.basename(outPath),
            folder: path.dirname(outPath),
            size: '720x?',
          });
      });
      const raw = await fs.readFile(outPath);
      return sharp(raw).jpeg({ quality: 82 }).toBuffer();
    } finally {
      fs.unlink(outPath).catch(() => {});
    }
  });
}

export const mediaService = {
  upload: async (
    uploaderId: string,
    file: Express.Multer.File,
    mediaType: MediaType,
    scope: MediaDeliveryScope = 'chat',
  ): Promise<IUploadResult> => {
    return processOneFile(uploaderId, file, mediaType, scope);
  },

  uploadMulti: async (
    uploaderId: string,
    files: Express.Multer.File[],
    mediaType?: MediaType,
    scope: MediaDeliveryScope = 'chat',
  ): Promise<IUploadResult[]> => {
    const mode: ProcessMediaMode = mediaType ?? 'auto';
    const concurrency = 4;
    const results: IUploadResult[] = [];
    for (let i = 0; i < files.length; i += concurrency) {
      const chunk = files.slice(i, i + concurrency);
      const part = await Promise.all(chunk.map((f) => processOneFile(uploaderId, f, mode, scope)));
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
    const delivery = resolveDeliveryUrls(media);
    return {
      mediaUrl: delivery.mediaUrl,
      mediaType: media.mimeType,
      mediaSize: media.size,
      thumbnailUrl: delivery.thumbnailUrl,
      originalName: media.originalName,
    };
  },

  /**
   * Chuyển tiếp tin: URL download của app → metadata từ bản ghi media (không kiểm tra uploader).
   * Trả null nếu URL không đúng dạng hoặc không có media.
   */
  resolveMediaFromAppDownloadUrl: async (
    mediaUrl: string,
  ): Promise<{
    mediaUrl: string;
    mediaType: string;
    mediaSize: number;
    thumbnailUrl: string | null;
    originalName: string;
    uploaderId: string;
  } | null> => {
    const id = parseMediaIdFromAppDownloadUrl(mediaUrl) ?? parseMediaIdFromObjectUrl(mediaUrl);
    if (!id) return null;
    const media = await mediaRepository.findById(id);
    if (!media) return null;
    const delivery = resolveDeliveryUrls(media);
    return {
      mediaUrl: delivery.mediaUrl,
      mediaType: media.mimeType,
      mediaSize: media.size,
      thumbnailUrl: delivery.thumbnailUrl,
      originalName: media.originalName,
      uploaderId: media.uploaderId,
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
    if (!media.visibility) {
      return getSignedGetUrl(media.s3Key);
    }
    if (media.visibility === 'private') {
      return signPrivateCdnUrl(media.s3Key);
    }
    const publicUrl = buildPublicCdnUrl(media.s3Key);
    if (publicUrl) return publicUrl;
    return getSignedGetUrl(media.s3Key);
  },

  /** Stream S3 object — dùng khi client tải file và cần giữ đúng tên gốc. */
  streamMediaForDownload: async (
    mediaId: string,
  ): Promise<{
    stream: import('node:stream').Readable;
    contentType: string;
    contentLength?: number;
    originalName: string;
  }> => {
    const media = await mediaRepository.findById(mediaId);
    if (!media) throw new NotFoundError('Media');
    const { stream, contentType, contentLength } = await getObjectStream(media.s3Key);
    return {
      stream,
      contentType: contentType ?? media.mimeType,
      contentLength,
      originalName: media.originalName,
    };
  },

  getThumbnailUrl: async (mediaId: string): Promise<string> => {
    const media = await mediaRepository.findById(mediaId);
    if (!media) throw new NotFoundError('Media');
    if (!media.s3ThumbnailKey) {
      return mediaService.getDownloadUrl(mediaId);
    }
    if (!media.visibility) {
      return getSignedGetUrl(media.s3ThumbnailKey);
    }
    if (media.visibility === 'private') {
      return signPrivateCdnUrl(media.s3ThumbnailKey);
    }
    const publicThumbUrl = buildPublicCdnUrl(media.s3ThumbnailKey);
    if (publicThumbUrl) return publicThumbUrl;
    return getSignedGetUrl(media.s3ThumbnailKey);
  },
};
