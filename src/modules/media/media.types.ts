import type { TimestampFields } from '@/shared/types/common.types.js';

export type MediaType = 'image' | 'video' | 'audio' | 'file';
export type MediaVisibility = 'public' | 'private';
export type MediaDeliveryScope = 'chat' | 'general';

export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mpeg',
  'audio/ogg',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.rar',
  'application/x-rar-compressed',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100MB
export const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50MB
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25MB

export interface IMedia extends TimestampFields {
  mediaId: string;
  uploaderId: string;
  url: string;
  thumbnailUrl: string | null;
  visibility: MediaVisibility;
  scope: MediaDeliveryScope;
  s3Key: string;
  s3ThumbnailKey: string | null;
  type: MediaType;
  mimeType: AllowedMimeType;
  size: number;
  originalName: string;
  durationMs?: number;
  width?: number;
  height?: number;
  codec?: string | null;
  bitrate?: number | null;
}

export interface IUploadResult {
  mediaId: string;
  url: string;
  thumbnailUrl: string | null;
  visibility: MediaVisibility;
  scope: MediaDeliveryScope;
  type: MediaType;
  size: number;
  mimeType: AllowedMimeType;
  durationMs?: number;
  width?: number;
  height?: number;
  codec?: string | null;
  bitrate?: number | null;
}
