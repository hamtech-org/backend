import type { TimestampFields } from '@/shared/types/common.types.js';

export type PostType = 'text' | 'image' | 'video' | 'link';
export type PostVisibility = 'public' | 'friends' | 'private';
export type ModerationStatus = 'pending' | 'approved' | 'rejected';
export type PostPublicationStatus = 'draft' | 'published';

export interface IAuthorInfo {
  userId: string;
  displayName: string;
  avatar: string | null;
}

export interface IPost extends TimestampFields {
  postId: string;
  authorId: string;
  content: string;
  mediaUrls: string[];
  type: PostType;
  visibility: PostVisibility;
  publicationStatus: PostPublicationStatus;
  categories: string[];
  tags: string[];
  reactionsCount: Record<string, number>;
  commentsCount: number;
  sharesCount: number;
  viewsCount: number;
  isModerated: boolean;
  moderationStatus: ModerationStatus;
  author?: IAuthorInfo; // Enrich ở service (không lưu DB)
}

export interface IComment extends TimestampFields {
  commentId: string;
  postId: string;
  authorId: string;
  content: string;
  parentId: string | null;
  reactionsCount: Record<string, number>;
  author?: IAuthorInfo; // Enrich ở service (không lưu DB)
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
  publicationStatus: PostPublicationStatus;
  categories?: string[];
  tags?: string[];
  mediaUrls?: string[];
}

export interface ICreateReelDto {
  videoUrl: string;
  caption: string;
  thumbnailUrl?: string;
}

export interface IFeedCursorPayload {
  createdAt: string;
  postId: string;
}

export interface IFeedPage {
  items: IPost[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ICommentsCursorPayload {
  createdAt: string;
  commentId: string;
}

export interface ICommentsPage {
  items: IComment[];
  nextCursor: string | null;
  hasMore: boolean;
}
