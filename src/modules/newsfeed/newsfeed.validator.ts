import { z } from 'zod';

export const createPostSchema = z.object({
  content: z.string().max(20000),
  type: z.enum(['text', 'image', 'video', 'link']),
  visibility: z.enum(['public', 'friends', 'private']),
  publicationStatus: z.enum(['draft', 'published']),
  categories: z.array(z.string().min(1).max(50)).optional(),
  tags: z.array(z.string().min(1).max(50)).optional(),
  mediaUrls: z.array(z.string().url()).optional(),
});

export const updatePostSchema = z.object({
  content: z.string().max(20000).optional(),
  visibility: z.enum(['public', 'friends', 'private']).optional(),
  publicationStatus: z.enum(['draft', 'published']).optional(),
  categories: z.array(z.string().min(1).max(50)).optional(),
  tags: z.array(z.string().min(1).max(50)).optional(),
  type: z.enum(['text', 'image', 'video', 'link']).optional(),
  mediaUrls: z.array(z.string().url()).optional(),
});

export const createReelSchema = z.object({
  videoUrl: z.string().url(),
  thumbnailUrl: z.string().url().optional().nullable(),
  caption: z.string().max(2200).optional().default(''),
  durationMs: z.number().int().min(0).max(600000),
  width: z.number().int().min(0),
  height: z.number().int().min(0),
  aspectRatio: z.enum(['9:16', '1:1', '4:5']).optional(),
  visibility: z.enum(['public', 'friends', 'private']).optional(),
});

export const reelsFeedQuerySchema = z.object({
  feed: z.enum(['foryou', 'following']).optional(),
  limit: z.coerce.number().int().min(1).max(20).optional(),
  cursor: z.string().optional(),
});

export const reelViewSchema = z.object({
  watchedMs: z.number().int().min(0).max(120000),
  completed: z.boolean().optional(),
});

export const reportReelSchema = z.object({
  reason: z.enum(['spam', 'nudity', 'hate', 'violence', 'other']),
  details: z.string().max(500).optional(),
});

export const addCommentSchema = z
  .object({
    content: z.string().max(2000).optional(),
    parentId: z.string().uuid().optional(),
    mediaUrls: z.array(z.string().url()).max(1).optional(),
  })
  .refine((d) => (d.content && d.content.trim().length > 0) || d.mediaUrls?.length, {
    message: 'Bình luận phải có nội dung hoặc ảnh',
  });

export const reactSchema = z.object({
  type: z.enum(['like', 'love', 'haha', 'wow', 'sad', 'angry']),
});

export const reactCommentSchema = z.object({
  postId: z.string().uuid(),
  type: z.enum(['like', 'love', 'haha', 'wow', 'sad', 'angry']),
});

export const reactReelSchema = z.object({
  type: z.enum(['like', 'love', 'haha', 'wow', 'sad', 'angry']),
});

export const sharePostSchema = z.object({
  content: z.string().max(20000).optional(),
  visibility: z.enum(['public', 'friends', 'private']).optional(),
});
