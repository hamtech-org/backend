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
  caption: z.string().max(500),
  thumbnailUrl: z.string().url().optional(),
});

export const addCommentSchema = z.object({
  content: z.string().min(1).max(2000),
  parentId: z.string().uuid().optional(),
});

export const reactSchema = z.object({
  type: z.enum(['like', 'love', 'haha', 'wow', 'sad', 'angry']),
});
