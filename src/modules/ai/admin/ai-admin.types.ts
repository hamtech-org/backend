import type { AiTextProvider } from '@/config/ai.js';

export type AiAdminConfig = {
  provider: AiTextProvider;
  maxTokens: number;
  temperature: number;
  topP: number;
  bedrockRegion: string;
  bedrockModelId: string;
  bedrockSecondaryModelId?: string;
  bedrockAccessKeyConfigured: boolean;
  bedrockSecretKeyConfigured: boolean;
  openAiModelId: string;
  openAiBaseUrl: string;
  openAiApiKeyConfigured: boolean;
  bedrockEmbeddingModelId: string;
  embeddingDimension: number;
  qdrantUrl: string;
  qdrantApiKeyConfigured: boolean;
  qdrantCollection: string;
  updatedAt?: string;
  updatedBy?: string;
};

export type AiAdminConfigPatch = Partial<
  Omit<
    AiAdminConfig,
    | 'bedrockAccessKeyConfigured'
    | 'bedrockSecretKeyConfigured'
    | 'openAiApiKeyConfigured'
    | 'qdrantApiKeyConfigured'
    | 'updatedAt'
    | 'updatedBy'
  >
> & {
  bedrockAccessKeyId?: string;
  bedrockSecretAccessKey?: string;
  openAiApiKey?: string;
  qdrantApiKey?: string;
};

export type AiUsageLog = {
  usageId: string;
  createdAt: string;
  provider: AiTextProvider;
  modelId: string;
  feature?: string;
  stage?: string;
  userId?: string;
  threadId?: string;
  tokensUsed: number;
  latencyMs: number;
  success: boolean;
  error?: string;
};

export type AiUsageRange = 'day' | 'week' | 'month';
export type AiUsageInterval = 'hour' | 'day' | 'week' | 'month';

export type AiUsageTimelinePoint = {
  t: string;
  requests: number;
  tokens: number;
  errors: number;
  averageLatencyMs: number;
};

export type AiUsageSummary = {
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  totalTokens: number;
  averageLatencyMs: number;
  byProvider: Record<string, number>;
  timeline: AiUsageTimelinePoint[];
  meta: {
    range: AiUsageRange;
    interval: AiUsageInterval;
    from: string;
    to: string;
  };
  recent: AiUsageLog[];
};

export type AiConfigAudit = {
  auditId: string;
  createdAt: string;
  actorUserId: string;
  changes: Record<string, { before: unknown; after: unknown }>;
};
