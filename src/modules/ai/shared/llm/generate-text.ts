import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { createBedrockRuntimeClient, type AiTextConfig, type AiTextProvider } from '@/config/ai.js';
import { aiAdminService, getEffectiveAiRuntimeConfig } from '../../admin/ai-admin.service.js';

export type AiGenerateTextOptions = Partial<
  Pick<AiTextConfig, 'provider' | 'modelId' | 'maxTokens' | 'temperature' | 'topP'>
> & {
  systemPrompt?: string;
  signal?: AbortSignal;
  usage?: {
    feature?: string;
    stage?: string;
    userId?: string;
    threadId?: string;
  };
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
  region: string;
  bedrockAccessKeyId?: string;
  bedrockSecretAccessKey?: string;
  openAiApiKey?: string;
  openAiBaseUrl: string;
  geminiApiKey?: string;
  systemPrompt?: string;
  signal?: AbortSignal;
};

type TextGenerationAdapter = {
  generate(prompt: string, options: ResolvedAiGenerateTextOptions): Promise<AiGenerateTextResult>;
};

const bedrockTextAdapter: TextGenerationAdapter = {
  async generate(prompt, options) {
    const client = createBedrockRuntimeClient({
      provider: 'bedrock',
      region: options.region,
      bedrockAccessKeyId: options.bedrockAccessKeyId,
      bedrockSecretAccessKey: options.bedrockSecretAccessKey,
    });
    const res = await client.send(
      new ConverseCommand({
        modelId: options.modelId,
        ...(options.systemPrompt
          ? {
              system: [{ text: options.systemPrompt }],
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
    if (!options.openAiApiKey) {
      throw new Error('AI của bạn đang bị lỗi :(( Mã lỗi 001');
    }

    const messages = [
      ...(options.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
      { role: 'user', content: prompt },
    ];
    const response = await fetch(`${options.openAiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.openAiApiKey}`,
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
        `OpenAI generateText loi ${response.status}: ${detail || response.statusText}`,
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

const geminiTextAdapter: TextGenerationAdapter = {
  async generate(prompt, options) {
    if (!options.geminiApiKey) {
      throw new Error('AI của bạn đang bị lỗi :(( Mã lỗi 002');
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        options.modelId,
      )}:generateContent?key=${encodeURIComponent(options.geminiApiKey)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...(options.systemPrompt
            ? {
                systemInstruction: {
                  parts: [{ text: options.systemPrompt }],
                },
              }
            : {}),
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            maxOutputTokens: options.maxTokens,
            temperature: options.temperature,
            topP: options.topP,
          },
        }),
        signal: options.signal,
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Gemini generateText loi ${response.status}: ${detail || response.statusText}`,
      );
    }

    const json = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
      usageMetadata?: { totalTokenCount?: number };
      modelVersion?: string;
    };
    const text =
      json.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? '')
        .filter(Boolean)
        .join('')
        .trim() ?? '';

    return {
      text,
      model: json.modelVersion || options.modelId,
      ...(typeof json.usageMetadata?.totalTokenCount === 'number'
        ? { tokensUsed: json.usageMetadata.totalTokenCount }
        : {}),
    };
  },
};

const TEXT_GENERATION_ADAPTERS: Record<AiTextProvider, TextGenerationAdapter> = {
  bedrock: bedrockTextAdapter,
  openai: openAiTextAdapter,
  gemini: geminiTextAdapter,
};

export async function generateText(
  prompt: string,
  options: AiGenerateTextOptions = {},
): Promise<AiGenerateTextResult> {
  const config = await getEffectiveAiRuntimeConfig();
  const input = prompt?.trim();
  if (!input) {
    return { text: '', model: options.modelId ?? config.modelId, tokensUsed: 0 };
  }
  if (options.signal?.aborted) {
    throw new DOMException('AI request was cancelled', 'AbortError');
  }

  const provider = options.provider ?? config.provider;
  const modelId = options.modelId ?? config.modelId;
  const maxTokens = options.maxTokens ?? config.maxTokens;
  const temperature = options.temperature ?? config.temperature;
  const topP = options.topP ?? config.topP;
  const adapter = TEXT_GENERATION_ADAPTERS[provider];
  const started = Date.now();

  try {
    const result = await adapter.generate(input, {
      provider,
      modelId,
      maxTokens,
      temperature,
      topP,
      region: config.region,
      bedrockAccessKeyId: config.bedrockAccessKeyId,
      bedrockSecretAccessKey: config.bedrockSecretAccessKey,
      openAiApiKey: config.openAiApiKey,
      openAiBaseUrl: config.openAiBaseUrl,
      geminiApiKey: config.geminiApiKey,
      systemPrompt: options.systemPrompt,
      signal: options.signal,
    });
    await aiAdminService.recordUsage({
      provider,
      modelId: result.model || modelId,
      tokensUsed: result.tokensUsed ?? 0,
      latencyMs: Date.now() - started,
      success: true,
      ...(options.usage?.feature ? { feature: options.usage.feature } : {}),
      ...(options.usage?.stage ? { stage: options.usage.stage } : {}),
      ...(options.usage?.userId ? { userId: options.usage.userId } : {}),
      ...(options.usage?.threadId ? { threadId: options.usage.threadId } : {}),
    });
    return result;
  } catch (error) {
    await aiAdminService.recordUsage({
      provider,
      modelId,
      tokensUsed: 0,
      latencyMs: Date.now() - started,
      success: false,
      error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      ...(options.usage?.feature ? { feature: options.usage.feature } : {}),
      ...(options.usage?.stage ? { stage: options.usage.stage } : {}),
      ...(options.usage?.userId ? { userId: options.usage.userId } : {}),
      ...(options.usage?.threadId ? { threadId: options.usage.threadId } : {}),
    });
    throw error;
  }
}
