import { createHash } from 'crypto';
import { embedText } from '../../shared/llm/embedding.service.js';
import { generateText } from '../../shared/llm/generate-text.js';
import {
  type AiMemoryPayload,
  type AiMemoryType,
  getQdrantClient,
  searchAiMemories,
  upsertAiMemoryVector,
} from '../../shared/rag/qdrant.client.js';

const MEMORY_TYPES: AiMemoryType[] = [
  'preference',
  'project',
  'interest',
  'identity',
  'task',
  'thread_summary',
];

type ExtractedMemory = {
  type?: string;
  text?: string;
  confidence?: number;
  importance?: number;
};

function stableUuid(input: string): string {
  const h = createHash('sha256').update(input).digest('hex').slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function parseExtractedMemories(text: string): ExtractedMemory[] {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as { memories?: unknown };
    return Array.isArray(parsed.memories) ? (parsed.memories as ExtractedMemory[]) : [];
  } catch {
    return [];
  }
}

function normalizeMemoryType(value: string | undefined): AiMemoryType | null {
  const type = value?.trim() as AiMemoryType | undefined;
  return type && MEMORY_TYPES.includes(type) ? type : null;
}

function clamp01(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function shouldStoreMemory(memory: {
  text: string;
  confidence: number;
  importance: number;
}): boolean {
  if (memory.text.length < 12 || memory.text.length > 700) return false;
  if (memory.confidence < 0.55 || memory.importance < 0.5) return false;
  return true;
}

function buildMemoryExtractionPrompt(params: {
  userMessage: string;
  assistantReply: string;
}): string {
  return [
    'Bạn là hệ thống trích xuất trí nhớ dài hạn cho AI assistant.',

    'Nhiệm vụ:',

    'Chỉ lưu thông tin ổn định, có thể hữu ích trong các cuộc trò chuyện tương lai.',
    'KHÔNG trả lời người dùng.',
    'KHÔNG tiếp tục hội thoại.',
    'KHÔNG tóm tắt cuộc trò chuyện.',
    'KHÔNG lưu các câu hỏi tạm thời hoặc ngữ cảnh ngắn hạn.',

    'Chỉ lưu:',

    'sở thích lâu dài',
    'dự án đang làm',
    'công nghệ thường dùng',
    'mục tiêu dài hạn',
    'thói quen',
    'mối quan tâm lặp lại',

    'KHÔNG lưu:',

    'small talk',
    'câu hỏi nhất thời',
    'hội thoại tạm thời',
    'lời chào',
    'yêu cầu ngắn hạn',
    'thông tin nhạy cảm',

    'Nếu không có trí nhớ dài hạn hữu ích:',
    '{"memories":[]}',

    'Output chỉ được là JSON hợp lệ.',

    'Schema:',
    '{',
    '"memories":[',
    '{',
    '"type":"preference | project | interest | identity | task | thread_summary"',
    '"text":"string"',
    '"confidence":"number"',
    '"importance":"number"',
    '}',
    ']',
    '}',
    'Cuộc trò chuyện cần phân tích Lưu ý cuộc trò chuyện dưới đây chỉ giúp bạn phân ',
    'tích trích xuất trí nhớ dài hạn cho AI assistant cũng không phải nhờ bạn trả lời ',
    'hay phản hồi chỉ là phân tích hành vi của user, nếu không có gì để phân tích thì trả ',
    'về đúng {"memories":[]}, còn nếu có thì trả về đúng format JSON',
    '{',
    '"memories":[',
    '{',
    '"type":"preference | project | interest | identity | task | thread_summary"',
    '"text":"string"',
    '"confidence":"number"',
    '"importance":"number"',
    '}',
    ']',
    '}',
    ' và đây là đoạn bạn cần phân tích:',
    `User: ${params.userMessage}`,
    `Assistant: ${params.assistantReply}`,
  ].join('\n');
}

export async function buildMemoryContextBlock(params: {
  userId: string;
  message: string;
  signal?: AbortSignal;
}): Promise<string> {
  if (!getQdrantClient()) return '';
  const vector = await embedText(params.message, params.signal);
  const hits = await searchAiMemories({
    userId: params.userId,
    vector,
    limit: 12,
  });
  const useful = hits.filter(
    (h) => h.text.trim().length > 0 && h.memoryType.trim().length > 0 && h.score >= 0.25,
  );
  const selected = useful.slice(0, 5);
  if (!selected.length) return '';
  return `\nGhi nhớ dài hạn liên quan:\n${selected
    .map((h, i) => `${i + 1}. [${h.memoryType || 'memory'}] ${h.text}`)
    .join('\n')}\n`;
}

export async function extractAndStoreTurnMemories(params: {
  userId: string;
  threadId: string;
  userMessageId: string;
  assistantMessageId: string;
  userMessage: string;
  assistantReply: string;
  signal?: AbortSignal;
}): Promise<void> {
  if (!getQdrantClient()) return;
  const prompt = buildMemoryExtractionPrompt(params);

  const extraction = await generateText(prompt, {
    temperature: 0.1,
    maxTokens: 500,
    signal: params.signal,
  });
  const now = new Date().toISOString();
  const memories = parseExtractedMemories(extraction.text).slice(0, 4);

  for (const raw of memories) {
    const memoryType = normalizeMemoryType(raw.type);
    const text = typeof raw.text === 'string' ? raw.text.trim() : '';
    if (!memoryType || !text) continue;
    const confidence = clamp01(raw.confidence, 0.7);
    const importance = clamp01(raw.importance, 0.6);
    if (!shouldStoreMemory({ text, confidence, importance })) continue;

    const memoryId = stableUuid(`${params.userId}:${memoryType}:${text.toLowerCase()}`);
    const vector = await embedText(text, params.signal);
    const payload: AiMemoryPayload = {
      userId: params.userId,
      threadId: params.threadId,
      memoryId,
      memoryType,
      text,
      sourceMessageIds: [params.userMessageId, params.assistantMessageId],
      confidence,
      importance,
      createdAt: now,
      updatedAt: now,
    };
    await upsertAiMemoryVector(memoryId, vector, payload);
  }
}
