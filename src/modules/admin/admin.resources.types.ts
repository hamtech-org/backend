import type { MediaType } from '@/modules/media/media.types.js';

export type ResourceSource = 'chat_direct' | 'chat_group' | 'post' | 'reel' | 'avatar' | 'other';

export interface IResourceBreakdownCell {
  source: ResourceSource;
  type: MediaType;
  bytes: number;
  count: number;
}

export interface IResourceBySourceRow {
  source: ResourceSource;
  bytes: number;
  count: number;
  percent: number;
}

export interface IResourceByTypeRow {
  type: MediaType;
  bytes: number;
  count: number;
  percent: number;
}

export interface IResourceTopUploader {
  userId: string;
  displayName: string;
  bytes: number;
  count: number;
}

export interface IAdminResourceSummary {
  totalBytes: number;
  totalFiles: number;
  computedAt: string;
  cachedUntil: string;
  matrix: IResourceBreakdownCell[];
  bySource: IResourceBySourceRow[];
  byType: IResourceByTypeRow[];
  topUploaders: IResourceTopUploader[];
}
