import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockRuntimeClient } from '@/config/ai.js';
import { env } from '@/config/env.js';

type TitanEmbedV2Response = {
  embedding?: number[];
};

export async function embedText(text: string, signal?: AbortSignal): Promise<number[]> {
  const input = text?.trim();
  if (!input) return [];
  if (signal?.aborted) {
    throw new DOMException('AI request was cancelled', 'AbortError');
  }

  const modelId = env.BEDROCK_EMBEDDING_MODEL_ID;
  const body = JSON.stringify({ inputText: input });

  const res = await bedrockRuntimeClient.send(
    new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: Buffer.from(body, 'utf-8'),
    }),
    signal ? { abortSignal: signal } : undefined,
  );

  const raw = new TextDecoder().decode(res.body);
  const json = JSON.parse(raw) as TitanEmbedV2Response;
  const emb = json.embedding;
  if (!Array.isArray(emb) || emb.length === 0) {
    throw new Error('Embedding rỗng từ Bedrock');
  }
  return emb;
}
