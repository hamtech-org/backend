import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

export type AiTextProvider = 'bedrock' | 'openai' | 'gemini';

export type AiTextConfig = {
  provider: AiTextProvider;
  region: string;
  modelId: string;
  maxTokens: number;
  temperature: number;
  topP: number;
  bedrockAccessKeyId?: string;
  bedrockSecretAccessKey?: string;
  openAiApiKey?: string;
  openAiBaseUrl: string;
  geminiApiKey?: string;
};

export type BedrockAiConfig = AiTextConfig;

const DEFAULT_AI_CONFIG: AiTextConfig = {
  provider: 'bedrock',
  region: 'us-east-1',
  modelId: 'amazon.nova-pro-v1:0',
  maxTokens: 1024,
  temperature: 0.2,
  topP: 0.9,
  openAiBaseUrl: 'https://api.openai.com/v1',
};

const DEFAULT_MODEL_BY_PROVIDER: Record<AiTextProvider, string> = {
  bedrock: 'amazon.nova-pro-v1:0',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.5-flash',
};

function readProvider(): AiTextProvider {
  const raw = (process.env.AI_TEXT_PROVIDER || process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (raw === 'openai' || raw === 'gemini') return raw;
  return 'bedrock';
}

export function getAiTextConfig(overrides: Partial<AiTextConfig> = {}): AiTextConfig {
  const provider = overrides.provider ?? readProvider();
  const envRegion = process.env.BEDROCK_REGION || process.env.AWS_REGION;
  const envModelId =
    provider === 'openai'
      ? process.env.OPENAI_MODEL_ID
      : provider === 'gemini'
        ? process.env.GEMINI_MODEL_ID
        : process.env.BEDROCK_MODEL_ID;
  const envMaxTokens = process.env.AI_MAX_TOKENS ? Number(process.env.AI_MAX_TOKENS) : undefined;
  const envTemperature = process.env.AI_TEMPERATURE
    ? Number(process.env.AI_TEMPERATURE)
    : undefined;
  const envTopP = process.env.AI_TOP_P ? Number(process.env.AI_TOP_P) : undefined;

  return {
    ...DEFAULT_AI_CONFIG,
    provider,
    modelId: DEFAULT_MODEL_BY_PROVIDER[provider],
    ...(envRegion ? { region: envRegion } : {}),
    ...(envModelId ? { modelId: envModelId } : {}),
    ...(Number.isFinite(envMaxTokens) ? { maxTokens: envMaxTokens! } : {}),
    ...(Number.isFinite(envTemperature) ? { temperature: envTemperature! } : {}),
    ...(Number.isFinite(envTopP) ? { topP: envTopP! } : {}),
    ...(process.env.BEDROCK_ACCESS_KEY_ID
      ? { bedrockAccessKeyId: process.env.BEDROCK_ACCESS_KEY_ID }
      : {}),
    ...(process.env.BEDROCK_SECRET_ACCESS_KEY
      ? { bedrockSecretAccessKey: process.env.BEDROCK_SECRET_ACCESS_KEY }
      : {}),
    ...(process.env.OPENAI_API_KEY ? { openAiApiKey: process.env.OPENAI_API_KEY } : {}),
    ...(process.env.OPENAI_BASE_URL ? { openAiBaseUrl: process.env.OPENAI_BASE_URL } : {}),
    ...(process.env.GEMINI_API_KEY ? { geminiApiKey: process.env.GEMINI_API_KEY } : {}),
    ...overrides,
  };
}

export function getBedrockConfig(overrides: Partial<BedrockAiConfig> = {}): BedrockAiConfig {
  return getAiTextConfig({ ...overrides, provider: 'bedrock' });
}

export function createBedrockRuntimeClient(config: Partial<AiTextConfig> = {}) {
  const resolved = getAiTextConfig({ ...config, provider: 'bedrock' });
  const accessKeyId =
    resolved.bedrockAccessKeyId ||
    process.env.BEDROCK_ACCESS_KEY_ID ||
    process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey =
    resolved.bedrockSecretAccessKey ||
    process.env.BEDROCK_SECRET_ACCESS_KEY ||
    process.env.AWS_SECRET_ACCESS_KEY;

  return new BedrockRuntimeClient({
    region: resolved.region,
    ...(accessKeyId &&
      secretAccessKey && {
        credentials: { accessKeyId, secretAccessKey },
      }),
  });
}

export const aiConfig = getAiTextConfig();
export const bedrockRuntimeClient = createBedrockRuntimeClient();
