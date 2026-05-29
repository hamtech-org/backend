import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import {
  aiConfig,
  bedrockRuntimeClient,
  type AiTextConfig,
  type AiTextProvider,
} from '@/config/ai.js';

export type AiGenerateTextOptions = Partial<
  Pick<AiTextConfig, 'provider' | 'modelId' | 'maxTokens' | 'temperature' | 'topP'>
> & {
  systemPrompt?: string;
  signal?: AbortSignal;
};

export type AiGenerateTextResult = {
  text: string;
  model: string;
  tokensUsed?: number;
};

type ResolvedAiGenerateTextOptions = {
  provider: AiTextProvider;
  modelId: string;
  maxTokens: number;
  temperature: number;
  topP: number;
  systemPrompt?: string;
  signal?: AbortSignal;
};

type TextGenerationAdapter = {
  generate(prompt: string, options: ResolvedAiGenerateTextOptions): Promise<AiGenerateTextResult>;
};

const bedrockTextAdapter: TextGenerationAdapter = {
  async generate(prompt, options) {
    const res = await bedrockRuntimeClient.send(
      new ConverseCommand({
        modelId: options.modelId,
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
            content: [{ text: prompt }],
          },
        ],
        inferenceConfig: {
          maxTokens: options.maxTokens,
          temperature: options.temperature,
          topP: options.topP,
        },
      }),
      options.signal ? { abortSignal: options.signal } : undefined,
    );

    const text =
      res.output?.message?.content
        ?.map((c) => ('text' in c ? c.text : ''))
        .filter(Boolean)
        .join('')
        .trim() ?? '';

    return {
      text,
      model: options.modelId,
      ...(typeof res.usage?.totalTokens === 'number' ? { tokensUsed: res.usage.totalTokens } : {}),
    };
  },
};

const openAiTextAdapter: TextGenerationAdapter = {
  async generate(prompt, options) {
    if (!aiConfig.openAiApiKey) {
      throw new Error('OPENAI_API_KEY chưa cấu hình cho AI_TEXT_PROVIDER=openai');
    }

    const messages = [
      ...(options.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
      { role: 'user', content: prompt },
    ];
    const response = await fetch(`${aiConfig.openAiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${aiConfig.openAiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options.modelId,
        messages,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        top_p: options.topP,
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `OpenAI generateText lỗi ${response.status}: ${detail || response.statusText}`,
      );
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number };
      model?: string;
    };
    const text = json.choices?.[0]?.message?.content?.trim() ?? '';
    return {
      text,
      model: json.model || options.modelId,
      ...(typeof json.usage?.total_tokens === 'number'
        ? { tokensUsed: json.usage.total_tokens }
        : {}),
    };
  },
};

const TEXT_GENERATION_ADAPTERS: Record<AiTextProvider, TextGenerationAdapter> = {
  bedrock: bedrockTextAdapter,
  openai: openAiTextAdapter,
};

export async function generateText(
  prompt: string,
  options: AiGenerateTextOptions = {},
): Promise<AiGenerateTextResult> {
  const input = prompt?.trim();
  if (!input) {
    return { text: '', model: options.modelId ?? aiConfig.modelId, tokensUsed: 0 };
  }
  if (options.signal?.aborted) {
    throw new DOMException('AI request was cancelled', 'AbortError');
  }

  const provider = options.provider ?? aiConfig.provider;
  const modelId = options.modelId ?? aiConfig.modelId;
  const maxTokens = options.maxTokens ?? aiConfig.maxTokens;
  const temperature = options.temperature ?? aiConfig.temperature;
  const topP = options.topP ?? aiConfig.topP;
  const adapter = TEXT_GENERATION_ADAPTERS[provider];

  return adapter.generate(input, {
    provider,
    modelId,
    maxTokens,
    temperature,
    topP,
    systemPrompt: options.systemPrompt,
    signal: options.signal,
  });
}
