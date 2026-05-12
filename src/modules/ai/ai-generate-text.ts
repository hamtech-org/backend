import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { aiConfig, bedrockRuntimeClient, type BedrockAiConfig } from '@/config/ai.js';

export type AiGenerateTextOptions = Partial<
  Pick<BedrockAiConfig, 'modelId' | 'maxTokens' | 'temperature' | 'topP'>
> & {
  systemPrompt?: string;
};

export type AiGenerateTextResult = {
  text: string;
  model: string;
  tokensUsed?: number;
};

export async function generateText(
  prompt: string,
  options: AiGenerateTextOptions = {},
): Promise<AiGenerateTextResult> {
  const input = prompt?.trim();
  if (!input) {
    return { text: '', model: options.modelId ?? aiConfig.modelId, tokensUsed: 0 };
  }

  const modelId = options.modelId ?? aiConfig.modelId;
  const maxTokens = options.maxTokens ?? aiConfig.maxTokens;
  const temperature = options.temperature ?? aiConfig.temperature;
  const topP = options.topP ?? aiConfig.topP;

  const res = await bedrockRuntimeClient.send(
    new ConverseCommand({
      modelId,
      ...(options.systemPrompt
        ? {
            system: [
              {
                text: options.systemPrompt,
              },
            ],
          }
        : {}),
      messages: [
        {
          role: 'user',
          content: [{ text: input }],
        },
      ],
      inferenceConfig: {
        maxTokens,
        temperature,
        topP,
      },
    }),
  );

  const text =
    res.output?.message?.content
      ?.map((c) => ('text' in c ? c.text : ''))
      .filter(Boolean)
      .join('')
      .trim() ?? '';

  const tokensUsed = res.usage?.totalTokens;

  return {
    text,
    model: modelId,
    ...(typeof tokensUsed === 'number' ? { tokensUsed } : {}),
  };
}
