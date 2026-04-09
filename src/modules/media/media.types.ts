import type { TimestampFields } from '@/shared/types/common.types.js';

export type MediaType = 'image' | 'video' | 'audio' | 'file';

export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/ogg',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export type AllowedMimeType = typeof ALLOWED_MIME_TYPES[number];

export interface IMedia extends TimestampFields {
  mediaId: string;
  uploaderId: string;
  url: string;
  thumbnailUrl: string | null;
  type: MediaType;
  mimeType: AllowedMimeType;
  size: number;
  originalName: string;
}

export interface IUploadResult {
  mediaId: string;
  url: string;
  thumbnailUrl: string | null;
  type: MediaType;
  size: number;
}
