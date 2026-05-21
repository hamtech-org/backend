import { z } from 'zod';
import { COMMUNITY_CATEGORIES } from './community.types.js';

export const communityCategorySchema = z.enum(COMMUNITY_CATEGORIES);

export const communityRuleSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
});

export const createCommunitySchema = z.object({
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  avatar: z.string().url().nullable().optional(),
  coverUrl: z.string().url().nullable().optional(),
  category: communityCategorySchema.optional(),
  rules: z.array(communityRuleSchema).max(10).optional(),
  type: z.enum(['public', 'private']),
  joinPolicy: z.enum(['open', 'approval']).optional(),
});

export const updateCommunitySchema = createCommunitySchema.partial();

export const listCommunitiesQuerySchema = z.object({
  category: communityCategorySchema.optional(),
  scope: z.enum(['discover', 'joined']).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().optional(),
});

export const joinCommunitySchema = z.object({
  message: z.string().max(500).optional(),
});

export const resolveJoinRequestSchema = z.object({
  action: z.enum(['approve', 'reject']),
});

export const updateMemberRoleSchema = z.object({
  role: z.enum(['admin', 'moderator', 'member']),
});

export const transferOwnerSchema = z.object({
  targetUserId: z.string().uuid(),
});

export const reportCommunitySchema = z.object({
  reason: z.enum(['spam', 'nudity', 'hate', 'violence', 'other']),
  details: z.string().max(500).optional(),
});
