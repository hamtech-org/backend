import type { TimestampFields } from '@/shared/types/common.types.js';

// ─── Reaction ─────────────────────────────────────────────────────────────────

export type ReactionType = 'like' | 'love' | 'haha' | 'wow' | 'sad' | 'angry';

export interface IReactionSummary {
  /** Số lượng từng loại reaction */
  counts: Partial<Record<ReactionType, number>>;
  /** Tổng số reactions */
  total: number;
  /** Reaction hiện tại của viewer (null = chưa react) */
  userReaction: ReactionType | null;
  /** Top 3 reaction nhiều nhất (để hiển thị emoji mini) */
  topReactions: ReactionType[];
}

// ─── Post ─────────────────────────────────────────────────────────────────────

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
  reactionsCount: Partial<Record<ReactionType, number>>;
  commentsCount: number;
  sharesCount: number;
  viewsCount: number;
  isModerated: boolean;
  moderationStatus: ModerationStatus;
  author?: IAuthorInfo; // Enrich ở service (không lưu DB)
  currentUserReaction?: ReactionType | null; // Enrich ở service
  isSaved?: boolean; // Enrich ở service
  sharedFrom?: ISharedPostInfo; // Bài gốc nếu đây là shared post
}

export interface IComment extends TimestampFields {
  commentId: string;
  postId: string;
  authorId: string;
  content: string;
  mediaUrls?: string[];
  parentId: string | null;
  reactionsCount: Partial<Record<ReactionType, number>>;
  repliesCount?: number;
  author?: IAuthorInfo;
  currentUserReaction?: ReactionType | null;
}

export type ReelAspectRatio = '9:16' | '1:1' | '4:5';
export type ReelProcessingStatus = 'pending' | 'ready' | 'failed';
export type ReelFeedKind = 'foryou' | 'following';

export interface IReel {
  reelId: string;
  authorId: string;
  videoUrl: string;
  thumbnailUrl: string;
  caption: string;
  /** @deprecated Use durationMs instead. Kept for backward compatibility. */
  duration?: number;
  durationMs: number;
  width: number;
  height: number;
  aspectRatio: ReelAspectRatio;
  visibility: PostVisibility;
  processingStatus: ReelProcessingStatus;
  hashtags: string[];
  mentions: string[];
  viewsCount: number;
  reactionsCount: Partial<Record<ReactionType, number>>;
  commentsCount: number;
  sharesCount: number;
  savesCount: number;
  engagementScore?: number;
  createdAt: string;
  updatedAt: string;
  // Enrich ở service (không lưu DB)
  author?: IAuthorInfo;
  currentUserReaction?: ReactionType | null;
  isSaved?: boolean;
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
  thumbnailUrl: string;
  caption: string;
  durationMs: number;
  width: number;
  height: number;
  aspectRatio?: ReelAspectRatio;
  visibility?: PostVisibility;
}

export interface IReelFeedCursorPayload {
  /** ISO date for following feed; numeric score (string) for foryou. */
  sortKey: string;
  reelId: string;
}

export interface IReelFeedPage {
  items: IReel[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface IReportReelDto {
  reason: 'spam' | 'nudity' | 'hate' | 'violence' | 'other';
  details?: string;
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

// ─── Share ────────────────────────────────────────────────────────────────────

export interface ISharedPostInfo {
  postId: string;
  authorId: string;
  content?: string;
  mediaUrls?: string[];
  type?: PostType;
  author?: IAuthorInfo;
  createdAt: string;
}

export interface ISharePostDto {
  content?: string;
  visibility?: PostVisibility;
}

// ─── Save ─────────────────────────────────────────────────────────────────────

export interface ISavedPost {
  userId: string;
  postId: string;
  savedAt: string;
  post?: IPost;
}

export interface ISavedPostsPage {
  items: ISavedPost[];
  nextCursor: string | null;
  hasMore: boolean;
}
