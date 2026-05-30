import { z } from 'zod';

const bedrockTextModelId = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.toLowerCase().includes('embed'), {
    message: 'Phải dùng Bedrock chat/text model, không dùng embedding model.',
  });

export const updateAiAdminConfigSchema = z.object({
  provider: z.enum(['bedrock', 'openai']).optional(),
  maxTokens: z.coerce.number().int().min(1).max(8192).optional(),
  temperature: z.coerce.number().min(0).max(2).optional(),
  topP: z.coerce.number().min(0).max(1).optional(),
  bedrockRegion: z.string().trim().min(1).optional(),
  bedrockModelId: bedrockTextModelId.optional(),
  bedrockSecondaryModelId: z
    .string()
    .trim()
    .refine((value) => !value || !value.toLowerCase().includes('embed'), {
      message: 'Phải dùng Bedrock chat/text model, không dùng embedding model.',
    })
    .optional(),
  bedrockAccessKeyId: z.string().trim().optional(),
  bedrockSecretAccessKey: z.string().trim().optional(),
  openAiModelId: z.string().trim().min(1).optional(),
  openAiBaseUrl: z.string().trim().min(1).optional(),
  openAiApiKey: z.string().trim().optional(),
  bedrockEmbeddingModelId: z.string().trim().min(1).optional(),
  embeddingDimension: z.coerce.number().int().min(1).max(4096).optional(),
  qdrantUrl: z.string().trim().optional(),
  qdrantApiKey: z.string().trim().optional(),
  qdrantCollection: z.string().trim().min(1).optional(),
});
