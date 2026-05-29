import {
  isBedrockTextGenerationModelId,
  resolveSecondaryModelId,
} from '../../shared/llm/bedrock-models.js';

describe('bedrock-models', () => {
  it('từ chối model embedding', () => {
    expect(isBedrockTextGenerationModelId('amazon.titan-embed-text-v1')).toBe(false);
    expect(isBedrockTextGenerationModelId('amazon.titan-embed-text-v2:0')).toBe(false);
  });

  it('chấp nhận model chat', () => {
    expect(isBedrockTextGenerationModelId('amazon.nova-lite-v1:0')).toBe(true);
    expect(isBedrockTextGenerationModelId('anthropic.claude-3-haiku-20240307-v1:0')).toBe(true);
  });

  it('resolveSecondaryModelId bỏ qua embed từ env', () => {
    const prev = process.env.BEDROCK_SECONDARY_MODEL_ID;
    process.env.BEDROCK_SECONDARY_MODEL_ID = 'amazon.titan-embed-text-v1';
    expect(resolveSecondaryModelId()).toBeUndefined();
    process.env.BEDROCK_SECONDARY_MODEL_ID = 'amazon.nova-lite-v1:0';
    expect(resolveSecondaryModelId()).toBe('amazon.nova-lite-v1:0');
    if (prev === undefined) {
      delete process.env.BEDROCK_SECONDARY_MODEL_ID;
    } else {
      process.env.BEDROCK_SECONDARY_MODEL_ID = prev;
    }
  });
});
