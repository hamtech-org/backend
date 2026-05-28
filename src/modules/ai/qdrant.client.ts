import { QdrantClient } from '@qdrant/js-client-rest';
import { env } from '@/config/env.js';
import { logger } from '@/shared/utils/logger.js';

let client: QdrantClient | null | undefined;
const warnedKeys = new Set<string>();
const TENANT_FIELD = 'userId';

function warnOnce(key: string, message: string): void {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  logger.warn(message);
}

function extractQdrantErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object') {
    const maybe = error as { data?: { status?: { error?: string } }; statusText?: string };
    if (maybe.data?.status?.error) return maybe.data.status.error;
    if (maybe.statusText) return maybe.statusText;
  }
  return String(error);
}

function readVectorSizeFromCollection(collection: unknown): number | null {
  const cfg = collection as {
    config?: {
      params?: {
        vectors?: { size?: number } | Record<string, { size?: number }> | null | undefined;
      };
    };
  };
  const vectors = cfg.config?.params?.vectors;
  if (!vectors) return null;
  if (typeof vectors === 'object' && 'size' in vectors) {
    const size = (vectors as { size?: unknown }).size;
    return typeof size === 'number' ? size : null;
  }
  const first = Object.values(vectors as Record<string, { size?: number }>)[0];
  return typeof first?.size === 'number' ? first.size : null;
}

async function getCollectionVectorSize(qc: QdrantClient, name: string): Promise<number | null> {
  try {
    const collection = await qc.getCollection(name);
    return readVectorSizeFromCollection(collection);
  } catch {
    return null;
  }
}

export function getQdrantClient(): QdrantClient | null {
  const url = env.QDRANT_URL?.trim();
  if (!url) return null;
  if (client === undefined) {
    client = new QdrantClient({
      url,
      apiKey: env.QDRANT_API_KEY?.trim() || undefined,
    });
  }
  return client;
}

export async function ensureAiAssistantCollection(vectorSize: number): Promise<void> {
  const qc = getQdrantClient();
  if (!qc) return;

  const name = env.QDRANT_COLLECTION.trim() || 'hamtech_ai_messages';
  const cols = await qc.getCollections();
  const exists = cols.collections.some((c) => c.name === name);
  if (exists) {
    const existingSize = await getCollectionVectorSize(qc, name);
    if (typeof existingSize === 'number' && existingSize !== vectorSize) {
      warnOnce(
        `qdrant-dim-mismatch-${name}`,
        `Qdrant collection "${name}" có dim=${existingSize}, nhưng embedding hiện tại là ${vectorSize}. Sẽ bỏ qua RAG cho đến khi đồng bộ dimension.`,
      );
    }
    return;
  }

  await qc.createCollection(name, {
    vectors: { size: vectorSize, distance: 'Cosine' },
  });
  logger.info(`Qdrant: đã tạo collection ${name} (dim=${vectorSize})`);
}

export type AiQdrantPayload = {
  userId: string;
  threadId: string;
  messageId: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
};

export async function upsertAiMessageVector(
  pointId: string,
  vector: number[],
  payload: AiQdrantPayload,
): Promise<void> {
  const qc = getQdrantClient();
  if (!qc || vector.length === 0) return;

  const name = env.QDRANT_COLLECTION.trim() || 'hamtech_ai_messages';
  await ensureAiAssistantCollection(vector.length);
  const existingSize = await getCollectionVectorSize(qc, name);
  if (typeof existingSize === 'number' && existingSize !== vector.length) {
    return;
  }
  await qc.upsert(name, {
    wait: true,
    points: [{ id: pointId, vector, payload }],
  });
}

export async function searchSimilarAiChunks(params: {
  userId: string;
  threadId: string;
  vector: number[];
  limit: number;
}): Promise<Array<{ score: number; text: string; role: string }>> {
  const qc = getQdrantClient();
  if (!qc || params.vector.length === 0) return [];

  const name = env.QDRANT_COLLECTION.trim() || 'hamtech_ai_messages';
  const existingSize = await getCollectionVectorSize(qc, name);
  if (typeof existingSize === 'number' && existingSize !== params.vector.length) {
    return [];
  }
  try {
    const res = await qc.search(name, {
      vector: params.vector,
      limit: params.limit,
      filter: {
        must: [
          { key: TENANT_FIELD, match: { value: params.userId } },
          { key: 'threadId', match: { value: params.threadId } },
        ],
      },
      with_payload: true,
    });
    return res.map((r) => ({
      score: typeof r.score === 'number' ? r.score : 0,
      text: String((r.payload as AiQdrantPayload | undefined)?.text ?? ''),
      role: String((r.payload as AiQdrantPayload | undefined)?.role ?? ''),
    }));
  } catch (e) {
    logger.warn(`Qdrant searchSimilarAiChunks lỗi (bỏ qua RAG): ${extractQdrantErrorMessage(e)}`);
    return [];
  }
}
