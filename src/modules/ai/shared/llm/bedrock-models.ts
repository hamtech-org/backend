import { env } from '@/config/env.js';
import { logger } from '@/shared/utils/logger.js';

const NON_CHAT_MODEL_MARKERS = ['embed', 'titan-embed'];

/** Model IDs suitable for Bedrock Converse / generateText (not embedding). */
export function isBedrockTextGenerationModelId(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  if (!id) return false;
  return !NON_CHAT_MODEL_MARKERS.some((marker) => id.includes(marker));
}

export function resolveSecondaryModelId(override?: string): string | undefined {
  const candidate = (override?.trim() || env.BEDROCK_SECONDARY_MODEL_ID?.trim()) ?? '';
  if (!candidate) return undefined;
  return isBedrockTextGenerationModelId(candidate) ? candidate : undefined;
}

export function isSecondaryModelConfigured(): boolean {
  return Boolean(resolveSecondaryModelId());
}

let warnedMisconfiguredSecondary = false;

export function warnIfSecondaryModelMisconfigured(): void {
  if (warnedMisconfiguredSecondary) return;
  const raw = env.BEDROCK_SECONDARY_MODEL_ID?.trim();
  if (!raw || isBedrockTextGenerationModelId(raw)) return;
  warnedMisconfiguredSecondary = true;
  logger.warn(
    `BEDROCK_SECONDARY_MODEL_ID="${raw}" không phải model chat (Converse). Tool invoke_secondary_model bị ẩn — đặt model chat, ví dụ amazon.nova-lite-v1:0.`,
  );
}
