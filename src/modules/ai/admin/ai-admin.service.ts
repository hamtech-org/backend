import { env } from '@/config/env.js';
import { getAiTextConfig, type AiTextConfig } from '@/config/ai.js';
import { ValidationError } from '@/shared/utils/errors.js';
import { decryptSecret, encryptSecret } from './ai-admin.crypto.js';
import { aiAdminRepository, type StoredAiAdminConfig } from './ai-admin.repository.js';
import type {
  AiAdminConfig,
  AiAdminConfigPatch,
  AiConfigAudit,
  AiUsageInterval,
  AiUsageLog,
  AiUsageRange,
  AiUsageSummary,
  AiUsageTimelinePoint,
} from './ai-admin.types.js';

type RuntimeAiConfig = AiTextConfig & {
  bedrockEmbeddingModelId: string;
  embeddingDimension: number;
  qdrantUrl: string;
  qdrantApiKey?: string;
  qdrantCollection: string;
  bedrockAccessKeyId?: string;
  bedrockSecretAccessKey?: string;
  bedrockSecondaryModelId?: string;
};

let cachedConfig: RuntimeAiConfig | null = null;

const DEFAULT_BEDROCK_TEXT_MODEL_ID = 'amazon.nova-pro-v1:0';

const DAY_MS = 86_400_000;

type UsageSummaryParams = {
  range?: AiUsageRange;
  interval?: AiUsageInterval;
};

function isTextGenerationModelId(modelId: string | undefined): boolean {
  const id = modelId?.trim().toLowerCase();
  if (!id) return false;
  return !id.includes('embed') && !id.includes('titan-embed');
}

function resolveBedrockTextModelId(modelId: string | undefined): string {
  const trimmed = modelId?.trim();
  return trimmed && isTextGenerationModelId(trimmed) ? trimmed : DEFAULT_BEDROCK_TEXT_MODEL_ID;
}

function assertBedrockTextModelId(modelId: string | undefined, fieldName: string): void {
  const trimmed = modelId?.trim();
  if (!trimmed || isTextGenerationModelId(trimmed)) return;
  throw new ValidationError(
    `${fieldName} phải là model chat/text của Bedrock, không dùng model embedding như ${trimmed}. Ví dụ: ${DEFAULT_BEDROCK_TEXT_MODEL_ID}`,
  );
}

function envConfig(): AiAdminConfig {
  const text = getAiTextConfig();
  return {
    provider: text.provider,
    maxTokens: text.maxTokens,
    temperature: text.temperature,
    topP: text.topP,
    bedrockRegion: text.region,
    bedrockModelId: resolveBedrockTextModelId(process.env.BEDROCK_MODEL_ID),
    bedrockAccessKeyConfigured: Boolean(
      process.env.BEDROCK_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
    ),
    bedrockSecretKeyConfigured: Boolean(
      process.env.BEDROCK_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY,
    ),
    ...(env.BEDROCK_SECONDARY_MODEL_ID && isTextGenerationModelId(env.BEDROCK_SECONDARY_MODEL_ID)
      ? { bedrockSecondaryModelId: env.BEDROCK_SECONDARY_MODEL_ID }
      : {}),
    openAiModelId: process.env.OPENAI_MODEL_ID || 'gpt-4o-mini',
    openAiBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    openAiApiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
    bedrockEmbeddingModelId: env.BEDROCK_EMBEDDING_MODEL_ID,
    embeddingDimension: env.AI_EMBEDDING_DIMENSION,
    qdrantUrl: env.QDRANT_URL,
    qdrantApiKeyConfigured: Boolean(env.QDRANT_API_KEY),
    qdrantCollection: env.QDRANT_COLLECTION,
  };
}

function publicConfig(stored: StoredAiAdminConfig | null): AiAdminConfig {
  if (!stored) return envConfig();
  const {
    encryptedBedrockAccessKeyId,
    encryptedBedrockSecretAccessKey,
    encryptedOpenAiApiKey,
    encryptedQdrantApiKey,
    ...cfg
  } = stored;
  return {
    ...cfg,
    bedrockModelId: resolveBedrockTextModelId(cfg.bedrockModelId),
    ...(cfg.bedrockSecondaryModelId && isTextGenerationModelId(cfg.bedrockSecondaryModelId)
      ? { bedrockSecondaryModelId: cfg.bedrockSecondaryModelId }
      : { bedrockSecondaryModelId: undefined }),
    bedrockAccessKeyConfigured: Boolean(
      encryptedBedrockAccessKeyId ||
      process.env.BEDROCK_ACCESS_KEY_ID ||
      process.env.AWS_ACCESS_KEY_ID,
    ),
    bedrockSecretKeyConfigured: Boolean(
      encryptedBedrockSecretAccessKey ||
      process.env.BEDROCK_SECRET_ACCESS_KEY ||
      process.env.AWS_SECRET_ACCESS_KEY,
    ),
    openAiApiKeyConfigured: Boolean(encryptedOpenAiApiKey || process.env.OPENAI_API_KEY),
    qdrantApiKeyConfigured: Boolean(encryptedQdrantApiKey || env.QDRANT_API_KEY),
  };
}

function toRuntime(config: AiAdminConfig, stored?: StoredAiAdminConfig | null): RuntimeAiConfig {
  return {
    provider: config.provider,
    region: config.bedrockRegion,
    modelId:
      config.provider === 'openai'
        ? config.openAiModelId
        : resolveBedrockTextModelId(config.bedrockModelId),
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    topP: config.topP,
    openAiBaseUrl: config.openAiBaseUrl,
    bedrockAccessKeyId:
      decryptSecret(stored?.encryptedBedrockAccessKeyId) ||
      process.env.BEDROCK_ACCESS_KEY_ID ||
      process.env.AWS_ACCESS_KEY_ID,
    bedrockSecretAccessKey:
      decryptSecret(stored?.encryptedBedrockSecretAccessKey) ||
      process.env.BEDROCK_SECRET_ACCESS_KEY ||
      process.env.AWS_SECRET_ACCESS_KEY,
    openAiApiKey: decryptSecret(stored?.encryptedOpenAiApiKey) || process.env.OPENAI_API_KEY,
    bedrockEmbeddingModelId: config.bedrockEmbeddingModelId,
    embeddingDimension: config.embeddingDimension,
    qdrantUrl: config.qdrantUrl,
    qdrantApiKey: decryptSecret(stored?.encryptedQdrantApiKey) || env.QDRANT_API_KEY,
    qdrantCollection: config.qdrantCollection,
    ...(config.bedrockSecondaryModelId
      ? { bedrockSecondaryModelId: config.bedrockSecondaryModelId }
      : {}),
  };
}

function diffConfig(before: AiAdminConfig, after: AiAdminConfig): AiConfigAudit['changes'] {
  const changes: AiConfigAudit['changes'] = {};
  for (const key of Object.keys(after) as Array<keyof AiAdminConfig>) {
    if (key === 'updatedAt' || key === 'updatedBy') continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes[key] = { before: before[key], after: after[key] };
    }
  }
  return changes;
}

function sanitizePatch(patch: AiAdminConfigPatch): AiAdminConfigPatch {
  assertBedrockTextModelId(patch.bedrockModelId, 'BEDROCK_MODEL_ID');
  assertBedrockTextModelId(patch.bedrockSecondaryModelId, 'BEDROCK_SECONDARY_MODEL_ID');
  return {
    ...patch,
    ...(patch.provider === 'openai' || patch.provider === 'bedrock'
      ? { provider: patch.provider }
      : {}),
    ...(typeof patch.maxTokens === 'number'
      ? { maxTokens: Math.max(1, Math.min(8192, patch.maxTokens)) }
      : {}),
    ...(typeof patch.temperature === 'number'
      ? { temperature: Math.max(0, Math.min(2, patch.temperature)) }
      : {}),
    ...(typeof patch.topP === 'number' ? { topP: Math.max(0, Math.min(1, patch.topP)) } : {}),
  };
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcWeek(date: Date): Date {
  const day = date.getUTCDay() || 7;
  return new Date(startOfUtcDay(date).getTime() - (day - 1) * DAY_MS);
}

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function datesBetween(from: Date, to: Date): string[] {
  const dates: string[] = [];
  for (let t = startOfUtcDay(from).getTime(); t <= to.getTime(); t += DAY_MS) {
    dates.push(dateKey(new Date(t)));
  }
  return dates;
}

function resolveUsageWindow(params: UsageSummaryParams) {
  const now = new Date();
  const range = params.range ?? 'day';
  const defaultInterval: AiUsageInterval =
    range === 'day' ? 'hour' : range === 'week' ? 'day' : 'day';
  const interval = params.interval ?? defaultInterval;
  const to = now;
  const from =
    range === 'day'
      ? startOfUtcDay(now)
      : range === 'week'
        ? new Date(startOfUtcDay(now).getTime() - 6 * DAY_MS)
        : new Date(startOfUtcDay(now).getTime() - 29 * DAY_MS);
  return { range, interval, from, to };
}

function bucketKey(date: Date, interval: AiUsageInterval): string {
  if (interval === 'hour') {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours()),
    ).toISOString();
  }
  if (interval === 'week') return startOfUtcWeek(date).toISOString();
  if (interval === 'month') return startOfUtcMonth(date).toISOString();
  return startOfUtcDay(date).toISOString();
}

function buildTimeline(rows: AiUsageLog[], interval: AiUsageInterval): AiUsageTimelinePoint[] {
  const buckets = new Map<
    string,
    { requests: number; tokens: number; errors: number; totalLatencyMs: number }
  >();
  for (const row of rows) {
    const key = bucketKey(new Date(row.createdAt), interval);
    const current = buckets.get(key) ?? {
      requests: 0,
      tokens: 0,
      errors: 0,
      totalLatencyMs: 0,
    };
    current.requests += 1;
    current.tokens += row.tokensUsed || 0;
    current.errors += row.success ? 0 : 1;
    current.totalLatencyMs += row.latencyMs || 0;
    buckets.set(key, current);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
    .map(([t, value]) => ({
      t,
      requests: value.requests,
      tokens: value.tokens,
      errors: value.errors,
      averageLatencyMs: value.requests ? Math.round(value.totalLatencyMs / value.requests) : 0,
    }));
}

export async function getEffectiveAiRuntimeConfig(): Promise<RuntimeAiConfig> {
  const stored = await aiAdminRepository.getConfig().catch(() => null);
  const cfg = publicConfig(stored);
  cachedConfig = toRuntime(cfg, stored);
  return cachedConfig;
}

export function getCachedAiRuntimeConfig(): RuntimeAiConfig {
  if (cachedConfig) return cachedConfig;
  const cfg = envConfig();
  return toRuntime(cfg, null);
}

export const aiAdminService = {
  getConfig: async (): Promise<AiAdminConfig> => {
    const stored = await aiAdminRepository.getConfig();
    const cfg = publicConfig(stored);
    cachedConfig = toRuntime(cfg, stored);
    return cfg;
  },

  updateConfig: async (patch: AiAdminConfigPatch, actorUserId: string): Promise<AiAdminConfig> => {
    const currentStored = await aiAdminRepository.getConfig();
    const before = publicConfig(currentStored);
    const clean = sanitizePatch(patch);
    const now = new Date().toISOString();
    const next: StoredAiAdminConfig = {
      ...before,
      ...clean,
      openAiApiKeyConfigured: before.openAiApiKeyConfigured || Boolean(clean.openAiApiKey),
      qdrantApiKeyConfigured: before.qdrantApiKeyConfigured || Boolean(clean.qdrantApiKey),
      updatedAt: now,
      updatedBy: actorUserId,
      ...(currentStored?.encryptedOpenAiApiKey
        ? { encryptedOpenAiApiKey: currentStored.encryptedOpenAiApiKey }
        : {}),
      ...(currentStored?.encryptedBedrockAccessKeyId
        ? { encryptedBedrockAccessKeyId: currentStored.encryptedBedrockAccessKeyId }
        : {}),
      ...(currentStored?.encryptedBedrockSecretAccessKey
        ? { encryptedBedrockSecretAccessKey: currentStored.encryptedBedrockSecretAccessKey }
        : {}),
      ...(currentStored?.encryptedQdrantApiKey
        ? { encryptedQdrantApiKey: currentStored.encryptedQdrantApiKey }
        : {}),
      ...(clean.bedrockAccessKeyId
        ? { encryptedBedrockAccessKeyId: encryptSecret(clean.bedrockAccessKeyId) }
        : {}),
      ...(clean.bedrockSecretAccessKey
        ? { encryptedBedrockSecretAccessKey: encryptSecret(clean.bedrockSecretAccessKey) }
        : {}),
      ...(clean.openAiApiKey ? { encryptedOpenAiApiKey: encryptSecret(clean.openAiApiKey) } : {}),
      ...(clean.qdrantApiKey ? { encryptedQdrantApiKey: encryptSecret(clean.qdrantApiKey) } : {}),
    };
    delete (next as { bedrockAccessKeyId?: string }).bedrockAccessKeyId;
    delete (next as { bedrockSecretAccessKey?: string }).bedrockSecretAccessKey;
    delete (next as { openAiApiKey?: string }).openAiApiKey;
    delete (next as { qdrantApiKey?: string }).qdrantApiKey;

    const after = publicConfig(next);
    const changes = diffConfig(before, after);
    await aiAdminRepository.putConfig(next);
    if (Object.keys(changes).length > 0) {
      await aiAdminRepository.appendAudit({ actorUserId, changes });
    }
    cachedConfig = toRuntime(after, next);
    return after;
  },

  recordUsage: async (log: Omit<AiUsageLog, 'usageId' | 'createdAt'>): Promise<void> => {
    await aiAdminRepository.appendUsage(log).catch(() => undefined);
  },

  getUsageSummary: async (params: UsageSummaryParams = {}): Promise<AiUsageSummary> => {
    const { range, interval, from, to } = resolveUsageWindow(params);
    const recent = (
      await aiAdminRepository.listUsageByDateRange(datesBetween(from, to), 200)
    ).filter((row) => {
      const createdAt = new Date(row.createdAt).getTime();
      return createdAt >= from.getTime() && createdAt <= to.getTime();
    });
    const totalRequests = recent.length;
    const successRequests = recent.filter((x) => x.success).length;
    const totalTokens = recent.reduce((sum, x) => sum + (x.tokensUsed || 0), 0);
    const averageLatencyMs = totalRequests
      ? Math.round(recent.reduce((sum, x) => sum + (x.latencyMs || 0), 0) / totalRequests)
      : 0;
    const byProvider = recent.reduce<Record<string, number>>((acc, row) => {
      acc[row.provider] = (acc[row.provider] ?? 0) + 1;
      return acc;
    }, {});
    return {
      totalRequests,
      successRequests,
      failedRequests: totalRequests - successRequests,
      totalTokens,
      averageLatencyMs,
      byProvider,
      timeline: buildTimeline(recent, interval),
      meta: {
        range,
        interval,
        from: from.toISOString(),
        to: to.toISOString(),
      },
      recent: recent.slice(0, 20),
    };
  },

  listAudits: async (): Promise<AiConfigAudit[]> => aiAdminRepository.listAudits(20),
};
