import type { TimestampFields } from '@/shared/types/common.types.js';

export type PostType = 'text' | 'image' | 'video' | 'link';
export type PostVisibility = 'public' | 'friends' | 'private';
export type ModerationStatus = 'pending' | 'approved' | 'rejected';

export interface IPost extends TimestampFields {
  postId: string;
  authorId: string;
  content: string;
  mediaUrls: string[];
  type: PostType;
  visibility: PostVisibility;
  reactionsCount: Record<string, number>;
  commentsCount: number;
  sharesCount: number;
  viewsCount: number;
  isModerated: boolean;
  moderationStatus: ModerationStatus;
}

export interface IComment extends TimestampFields {
  commentId: string;
  postId: string;
  authorId: string;
  content: string;
  parentId: string | null;
  reactionsCount: Record<string, number>;
}

export interface IReel {
  reelId: string;
  authorId: string;
  videoUrl: string;
  thumbnailUrl: string;
  caption: string;
  duration: number;
  viewsCount: number;
  reactionsCount: Record<string, number>;
  commentsCount: number;
  createdAt: string;
}

export interface ICreatePostDto {
  content: string;
  type: PostType;
  visibility: PostVisibility;
  mediaUrls?: string[];
}

export interface ICreateReelDto {
  videoUrl: string;
  caption: string;
  thumbnailUrl?: string;
}
