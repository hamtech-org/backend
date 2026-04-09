import { z } from 'zod';

export const createPostSchema = z.object({
  content: z.string().max(5000),
  type: z.enum(['text', 'image', 'video', 'link']),
  visibility: z.enum(['public', 'friends', 'private']),
  mediaUrls: z.array(z.string().url()).optional(),
});

export const updatePostSchema = z.object({
  content: z.string().max(5000).optional(),
  visibility: z.enum(['public', 'friends', 'private']).optional(),
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
