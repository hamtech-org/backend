import { AppError } from '@/shared/utils/errors.js';
import {
  ALLOWED_MIME_TYPES,
  MAX_AUDIO_BYTES,
  MAX_FILE_BYTES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  type AllowedMimeType,
  type MediaType,
} from './media.types.js';

const MIME_SET = new Set<string>(ALLOWED_MIME_TYPES);

let fileTypeFromBufferCached:
  | ((input: Uint8Array | ArrayBuffer) => Promise<{ mime: string } | undefined>)
  | undefined;

async function getFileTypeFromBuffer(): Promise<
  (input: Uint8Array | ArrayBuffer) => Promise<{ mime: string } | undefined>
> {
  if (!fileTypeFromBufferCached) {
    const mod = await import('file-type');
    fileTypeFromBufferCached = mod.fileTypeFromBuffer;
  }
  return fileTypeFromBufferCached;
}

function maxBytesForDeclaredType(mediaType: MediaType): number {
  switch (mediaType) {
    case 'image':
      return MAX_IMAGE_BYTES;
    case 'video':
      return MAX_VIDEO_BYTES;
    case 'audio':
      return MAX_AUDIO_BYTES;
    default:
      return MAX_FILE_BYTES;
  }
}

function declaredTypeMatchesMime(declared: MediaType, mime: string): boolean {
  if (declared === 'image') return mime.startsWith('image/');
  if (declared === 'video') return mime.startsWith('video/');
  if (declared === 'audio') return mime.startsWith('audio/');
  return (
    mime.startsWith('application/') ||
    mime === 'application/zip' ||
    mime === 'application/x-zip-compressed'
  );
}

/** Suy loại media từ MIME (sau khi đã magic-byte). */
export function mimeToMediaType(mime: string): MediaType {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

/**
 * Chỉ dùng cho upload multi không có mediaType client: nhận diện MIME + loại + giới hạn size.
 */
export async function assertValidUploadBufferAuto(
  buffer: Buffer,
  originalName: string,
): Promise<{ mimeType: AllowedMimeType; size: number; mediaType: MediaType }> {
  const size = buffer.length;
  if (size === 0) {
    throw new AppError('File rỗng', 400, 'EMPTY_FILE');
  }

  const fileTypeFromBuffer = await getFileTypeFromBuffer();
  const detected = await fileTypeFromBuffer(buffer);
  const mime = detected?.mime;
  if (!mime || !MIME_SET.has(mime)) {
    throw new AppError('Loại file không được hỗ trợ', 400, 'UNSUPPORTED_FILE_TYPE');
  }

  const mediaType = mimeToMediaType(mime);
  const max = maxBytesForDeclaredType(mediaType);
  if (size > max) {
    throw new AppError(`File vượt quá giới hạn (${max} bytes)`, 400, 'FILE_TOO_LARGE');
  }

  void originalName;
  return { mimeType: mime as AllowedMimeType, size, mediaType };
}

/**
 * Validates buffer with magic bytes, size, declared mediaType vs detected MIME.
 */
export async function assertValidUploadBuffer(
  buffer: Buffer,
  originalName: string,
  declaredMediaType: MediaType,
): Promise<{ mimeType: AllowedMimeType; size: number }> {
  const size = buffer.length;
  const max = maxBytesForDeclaredType(declaredMediaType);
  if (size > max) {
    throw new AppError(`File vượt quá giới hạn (${max} bytes)`, 400, 'FILE_TOO_LARGE');
  }
  if (size === 0) {
    throw new AppError('File rỗng', 400, 'EMPTY_FILE');
  }

  const fileTypeFromBuffer = await getFileTypeFromBuffer();
  const detected = await fileTypeFromBuffer(buffer);
  const mime = detected?.mime;
  if (!mime || !MIME_SET.has(mime)) {
    throw new AppError('Loại file không được hỗ trợ', 400, 'UNSUPPORTED_FILE_TYPE');
  }
  if (!declaredTypeMatchesMime(declaredMediaType, mime)) {
    throw new AppError('mediaType không khớp nội dung file', 400, 'MEDIA_TYPE_MISMATCH');
  }

  void originalName;
  return { mimeType: mime as AllowedMimeType, size };
}
