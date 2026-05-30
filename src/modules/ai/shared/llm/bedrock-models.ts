import { env } from '@/config/env.js';
import { logger } from '@/shared/utils/logger.js';
import { getCachedAiRuntimeConfig } from '../../admin/ai-admin.service.js';

const NON_CHAT_MODEL_MARKERS = ['embed', 'titan-embed'];

/** Model IDs suitable for text generation, not embedding. */
export function isTextGenerationModelId(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  if (!id) return false;
  return !NON_CHAT_MODEL_MARKERS.some((marker) => id.includes(marker));
}

/** Backward-compatible alias for existing Bedrock call sites/tests. */
export function isBedrockTextGenerationModelId(modelId: string): boolean {
  return isTextGenerationModelId(modelId);
}

export function resolveSecondaryModelId(override?: string): string | undefined {
  const liveEnv = process.env.BEDROCK_SECONDARY_MODEL_ID?.trim();
  const parsedEnv = env.BEDROCK_SECONDARY_MODEL_ID?.trim();
  const processEnvChanged = liveEnv !== parsedEnv;
  const candidate =
    (override?.trim() ||
      (processEnvChanged ? liveEnv : undefined) ||
      getCachedAiRuntimeConfig().bedrockSecondaryModelId?.trim() ||
      liveEnv ||
      parsedEnv) ??
    '';
  if (!candidate) return undefined;
  return isTextGenerationModelId(candidate) ? candidate : undefined;
}

export function isSecondaryModelConfigured(): boolean {
  return Boolean(resolveSecondaryModelId());
}

let warnedMisconfiguredSecondary = false;

export function warnIfSecondaryModelMisconfigured(): void {
  if (warnedMisconfiguredSecondary) return;
  const liveEnv = process.env.BEDROCK_SECONDARY_MODEL_ID?.trim();
  const parsedEnv = env.BEDROCK_SECONDARY_MODEL_ID?.trim();
  const processEnvChanged = liveEnv !== parsedEnv;
  const raw =
    (processEnvChanged ? liveEnv : undefined) ||
    getCachedAiRuntimeConfig().bedrockSecondaryModelId?.trim() ||
    liveEnv ||
    parsedEnv;
  if (!raw || isTextGenerationModelId(raw)) return;
  warnedMisconfiguredSecondary = true;
  logger.warn(
    `Bedrock secondary model "${raw}" is not a chat/text-generation model. Tool invoke_secondary_model is hidden; configure BEDROCK_SECONDARY_MODEL_ID with a chat model.`,
  );
}
