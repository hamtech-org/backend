import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

export type BedrockAiConfig = {
  region: string;
  modelId: string;
  maxTokens: number;
  temperature: number;
  topP: number;
};

const DEFAULT_BEDROCK_CONFIG: BedrockAiConfig = {
  region: 'us-east-1',
  modelId: 'amazon.nova-pro-v1:0',
  maxTokens: 1024,
  temperature: 0.2,
  topP: 0.9,
};

export function getBedrockConfig(overrides: Partial<BedrockAiConfig> = {}): BedrockAiConfig {
  const envRegion = process.env.BEDROCK_REGION || process.env.AWS_REGION;
  const envModelId = process.env.BEDROCK_MODEL_ID;
  const envMaxTokens = process.env.AI_MAX_TOKENS ? Number(process.env.AI_MAX_TOKENS) : undefined;
  const envTemperature = process.env.AI_TEMPERATURE
    ? Number(process.env.AI_TEMPERATURE)
    : undefined;
  const envTopP = process.env.AI_TOP_P ? Number(process.env.AI_TOP_P) : undefined;

  return {
    ...DEFAULT_BEDROCK_CONFIG,
    ...(envRegion ? { region: envRegion } : {}),
    ...(envModelId ? { modelId: envModelId } : {}),
    ...(Number.isFinite(envMaxTokens) ? { maxTokens: envMaxTokens! } : {}),
    ...(Number.isFinite(envTemperature) ? { temperature: envTemperature! } : {}),
    ...(Number.isFinite(envTopP) ? { topP: envTopP! } : {}),
    ...overrides,
  };
}

export function createBedrockRuntimeClient(config: Partial<BedrockAiConfig> = {}) {
  const resolved = getBedrockConfig(config);
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  return new BedrockRuntimeClient({
    region: resolved.region,
    ...(accessKeyId &&
      secretAccessKey && {
        credentials: { accessKeyId, secretAccessKey },
      }),
  });
}

export const aiConfig = getBedrockConfig();
export const bedrockRuntimeClient = createBedrockRuntimeClient();
