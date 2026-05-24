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
  isPostApprovalRequired: z.boolean().optional(),
  chatEnabled: z.boolean().optional(),
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

export const resolvePendingPostSchema = z.object({
  action: z.enum(['approve', 'reject']),
  rejectReason: z.string().max(500).optional(),
});

export const listModerationLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export const reportCommunityEntitySchema = z.object({
  entityType: z.enum(['POST', 'CMT', 'GROUP']),
  entityId: z.string().min(1),
  reason: z.enum([
    'spam',
    'harassment',
    'hate_speech',
    'inappropriate',
    'rules_violation',
    'other',
  ]),
  details: z.string().max(500).optional(),
  postId: z.string().optional(),
  createdAt: z.string().optional(),
});

export const resolveCommunityReportSchema = z.object({
  action: z.enum(['dismiss', 'delete_content', 'warn_user', 'ban_user']),
  notes: z.string().max(500).optional(),
});

export const listCommunityReportsQuerySchema = z.object({
  status: z
    .enum(['pending', 'resolved_deleted', 'resolved_dismissed', 'resolved_warned', 'resolved'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export const communityFeedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().optional(),
});

export const inviteFriendsSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(100),
});

export const updateAutoModSchema = z.object({
  autoModerateEnabled: z.boolean(),
  autoModerateAction: z.enum(['censor', 'block']),
  blacklistedKeywords: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(50)
        .refine((v) => !/[\r\n\t]/.test(v), 'Từ khóa chứa ký tự không hợp lệ'),
    )
    .max(100),
});
