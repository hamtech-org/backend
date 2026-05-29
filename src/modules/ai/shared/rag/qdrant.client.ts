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
  if (error && typeof error === 'object') {
    const maybe = error as {
      message?: string;
      data?: { status?: { error?: string } };
      statusText?: string;
    };
    const detail = maybe.data?.status?.error;
    if (detail) {
      const base = maybe.message ?? maybe.statusText ?? 'Qdrant error';
      return `${base}: ${detail}`;
    }
    if (maybe.message) return maybe.message;
    if (maybe.statusText) return maybe.statusText;
  }
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

const PAYLOAD_INDEX_FIELDS = ['userId', 'threadId'] as const;
const payloadIndexesReady = new Set<string>();

function isMissingPayloadIndexError(message: string): boolean {
  return /index required but not found/i.test(message);
}

async function ensurePayloadIndexes(qc: QdrantClient, collectionName: string): Promise<void> {
  if (payloadIndexesReady.has(collectionName)) return;

  let failed = false;
  for (const field_name of PAYLOAD_INDEX_FIELDS) {
    try {
      await qc.createPayloadIndex(collectionName, {
        field_name,
        field_schema: 'keyword',
        wait: true,
      });
    } catch (e) {
      const msg = extractQdrantErrorMessage(e);
      if (/already exists|exist/i.test(msg)) continue;
      failed = true;
      warnOnce(
        `qdrant-index-${field_name}`,
        `Qdrant createPayloadIndex "${field_name}" trên "${collectionName}": ${msg}`,
      );
    }
  }
  if (!failed) {
    payloadIndexesReady.add(collectionName);
    logger.info(
      `Qdrant: payload index sẵn sàng cho "${collectionName}" (${PAYLOAD_INDEX_FIELDS.join(', ')})`,
    );
  }
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
    await ensurePayloadIndexes(qc, name);
    return;
  }

  await qc.createCollection(name, {
    vectors: { size: vectorSize, distance: 'Cosine' },
  });
  await ensurePayloadIndexes(qc, name);
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

async function runFilteredVectorSearch(
  qc: QdrantClient,
  collectionName: string,
  params: { userId: string; threadId: string; vector: number[]; limit: number },
) {
  return qc.search(collectionName, {
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
  await ensureAiAssistantCollection(params.vector.length);

  const existingSize = await getCollectionVectorSize(qc, name);
  if (typeof existingSize === 'number' && existingSize !== params.vector.length) {
    return [];
  }

  const mapHits = (
    res: Awaited<ReturnType<QdrantClient['search']>>,
  ): Array<{ score: number; text: string; role: string }> =>
    res.map((r) => ({
      score: typeof r.score === 'number' ? r.score : 0,
      text: String((r.payload as AiQdrantPayload | undefined)?.text ?? ''),
      role: String((r.payload as AiQdrantPayload | undefined)?.role ?? ''),
    }));

  try {
    const res = await runFilteredVectorSearch(qc, name, params);
    return mapHits(res);
  } catch (e) {
    const msg = extractQdrantErrorMessage(e);
    if (isMissingPayloadIndexError(msg)) {
      payloadIndexesReady.delete(name);
      try {
        await ensurePayloadIndexes(qc, name);
        const res = await runFilteredVectorSearch(qc, name, params);
        return mapHits(res);
      } catch (retryErr) {
        logger.warn(
          `Qdrant searchSimilarAiChunks lỗi sau khi tạo index (bỏ qua RAG): ${extractQdrantErrorMessage(retryErr)}`,
        );
        return [];
      }
    }
    logger.warn(`Qdrant searchSimilarAiChunks lỗi (bỏ qua RAG): ${msg}`);
    return [];
  }
}

export async function deleteAiAssistantVectors(params: {
  userId: string;
  threadId: string;
}): Promise<void> {
  const qc = getQdrantClient();
  if (!qc) return;

  const userId = params.userId.trim();
  const threadId = params.threadId.trim();
  if (!userId || !threadId) return;

  const name = env.QDRANT_COLLECTION.trim() || 'hamtech_ai_messages';
  try {
    await qc.delete(name, {
      wait: true,
      filter: {
        must: [
          { key: TENANT_FIELD, match: { value: userId } },
          { key: 'threadId', match: { value: threadId } },
        ],
      },
    });
  } catch (e) {
    logger.warn(`Qdrant deleteAiAssistantVectors lỗi (bỏ qua): ${extractQdrantErrorMessage(e)}`);
  }
}
