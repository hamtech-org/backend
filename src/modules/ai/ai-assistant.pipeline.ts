import { generateText } from './ai-generate-text.js';
import { aiConfig } from '@/config/ai.js';
import { env } from '@/config/env.js';
import type { IAiAssistantRequest, IAiAssistantResponse } from './ai.types.js';
import { aiAssistantRepository } from './ai-assistant.repository.js';
import { embedText } from './ai-embedding.service.js';
import { searchSimilarAiChunks, upsertAiMessageVector } from './qdrant.client.js';
import { executeAiToolCalls, type AiToolCall } from './ai-assistant.tools.js';
import {
  getConfirmActionFromPending,
  isAffirmative,
  isNegative,
  parseConfirmToken,
  pickFirstConfirmTool,
} from './ai-tool-confirmation.js';

export type AiAssistantStage =
  | 'init'
  | 'persist_user_message'
  | 'await_user_confirmation'
  | 'embedding_query'
  | 'rag_search'
  | 'load_history'
  | 'model_reasoning'
  | 'tool_execution'
  | 'model_finalize'
  | 'persist_assistant_message'
  | 'embedding_reply'
  | 'completed';

type StageReporter = (stage: AiAssistantStage, detail?: string) => void;

export class AiAssistantCancelledError extends Error {
  constructor() {
    super('AI request was cancelled');
    this.name = 'AiAssistantCancelledError';
  }
}

export type AiAssistantPipelineOptions = {
  onStage?: StageReporter;
  signal?: AbortSignal;
};

type LlmJsonShape = {
  reply?: string;
  toolCalls?: AiToolCall[];
  messageResultIds?: string[];
  messageResultKeys?: string[];
};

const MAX_HISTORY_MESSAGE_CHARS = 1200;
const MAX_HISTORY_TRANSCRIPT_CHARS = 16000;
const MAX_RAG_CHUNK_CHARS = 900;
const SENSITIVE_PLACEHOLDER = '[Nội dung nhạy cảm đã được chặn]';

function normalizePipelineOptions(
  optionsOrReporter?: StageReporter | AiAssistantPipelineOptions,
): AiAssistantPipelineOptions {
  return typeof optionsOrReporter === 'function'
    ? { onStage: optionsOrReporter }
    : (optionsOrReporter ?? {});
}

function isAbortLike(error: unknown): boolean {
  if (error instanceof AiAssistantCancelledError) return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  return false;
}

export function isAiAssistantCancellation(error: unknown): boolean {
  return isAbortLike(error);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AiAssistantCancelledError();
  }
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function decodeJsonStringLoose(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      )
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\');
  }
}

function extractReplyLoose(text: string): string {
  const match = text.match(/"reply"\s*:\s*"((?:\\.|[^"\\])*)"/s);
  return match?.[1] ? decodeJsonStringLoose(match[1]).trim() : '';
}

function unwrapNestedJsonReply(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.includes('"reply"')) return value;
  const parsed = parseJsonLoose(trimmed);
  return typeof parsed?.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim() : value;
}

function sanitizeInternalIdsForUser(text: string): string {
  return text
    .replace(
      /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
      'thành viên',
    )
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalizeMessageResultSelector(value: string): string {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '');
  if (/^\d+$/.test(normalized)) return `R${normalized}`;
  return normalized;
}

function filterMessageResultActions(
  actions: import('./ai.types.js').AiAssistantClientAction[],
  selectedKeysOrIds: string[],
): import('./ai.types.js').AiAssistantClientAction[] {
  const selected = new Set(
    selectedKeysOrIds.map((id) => normalizeMessageResultSelector(id)).filter(Boolean),
  );
  return actions
    .map((action) => {
      if (action.type !== 'show_message_results') return action;
      const fallbackMessages = action.payload.messages.slice(0, 5);
      const selectedMessages =
        selected.size > 0
          ? action.payload.messages.filter((message) => {
              const resultKey = message.resultKey
                ? normalizeMessageResultSelector(message.resultKey)
                : '';
              return (
                (resultKey && selected.has(resultKey)) ||
                selected.has(normalizeMessageResultSelector(message.messageId))
              );
            })
          : fallbackMessages;
      const messages = (selectedMessages.length > 0 ? selectedMessages : fallbackMessages).slice(
        0,
        5,
      );
      return {
        ...action,
        payload: {
          ...action.payload,
          messages,
        },
      };
    })
    .filter((action) => action.type !== 'show_message_results' || action.payload.messages.length);
}

function parseJsonLoose(text: string): LlmJsonShape | null {
  const t = text.trim();
  if (!t) return null;
  try {
    const parsed = JSON.parse(t) as LlmJsonShape;
    if (typeof parsed.reply === 'string') parsed.reply = unwrapNestedJsonReply(parsed.reply);
    return parsed;
  } catch {
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(t.slice(start, end + 1)) as LlmJsonShape;
        if (typeof parsed.reply === 'string') parsed.reply = unwrapNestedJsonReply(parsed.reply);
        return parsed;
      } catch {
        const reply = extractReplyLoose(t.slice(start, end + 1));
        return reply ? { reply, toolCalls: [] } : null;
      }
    }
    const reply = extractReplyLoose(t);
    return reply ? { reply, toolCalls: [] } : null;
  }
}

function buildHistoryTranscript(
  rows: Array<{ role: string; content: string }>,
  maxLines: number,
): string {
  const slice = rows.slice(-maxLines);
  const transcript = slice
    .map(
      (r) =>
        `${r.role === 'assistant' ? 'AI' : 'User'}: ${truncateText(
          r.content,
          MAX_HISTORY_MESSAGE_CHARS,
        )}`,
    )
    .join('\n');
  return truncateText(transcript, MAX_HISTORY_TRANSCRIPT_CHARS);
}

function looksLikeMessageSearchRequest(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    /\b(search|find)\b.*\b(message|messages|chat|conversation)\b/.test(normalized) ||
    /(tìm|tim|kiếm|kiem|lục|luc|tra).{0,30}(tin nhắn|tin nhan|message|chat|hội thoại|hoi thoai)/.test(
      normalized,
    ) ||
    /(tin nhắn|tin nhan).{0,30}(về|ve|liên quan|lien quan|có nội dung|co noi dung)/.test(normalized)
  );
}

function detectSensitiveUserInput(text: string): string[] {
  const normalized = text.normalize('NFKC');
  const lower = normalized.toLowerCase();
  const findings = new Set<string>();

  const checks: Array<[string, RegExp]> = [
    [
      'OTP/mã xác thực',
      /\b(?:otp|mã\s*(?:otp|xác\s*thực|xac\s*thuc|2fa|mfa|code)|verification\s*code|auth(?:entication)?\s*code)\b.{0,40}\b\d{4,8}\b/i,
    ],
    ['mật khẩu', /\b(?:password|pass|passwd|pwd|mật\s*khẩu|mat\s*khau)\b\s*[:=：-]?\s*\S{4,}/i],
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)?PRIVATE KEY-----/i],
    [
      'API key/token/secret',
      /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|refresh[_-]?token|bearer\s+token|client[_-]?secret|github[_-]?token|slack[_-]?token)\b\s*[:=：-]?\s*['"]?[A-Za-z0-9._~+/=-]{12,}/i,
    ],
    ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
    ['JWT/token', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
    ['SSH key', /\bssh-(?:rsa|ed25519)\s+[A-Za-z0-9+/=]{80,}/i],
  ];

  for (const [label, pattern] of checks) {
    if (pattern.test(normalized)) findings.add(label);
  }

  if (
    /\b\d{4,8}\b/.test(normalized) &&
    /\b(?:otp|2fa|mfa|xác\s*thực|xac\s*thuc|verify|verification|đăng\s*nhập|dang\s*nhap)\b/i.test(
      lower,
    )
  ) {
    findings.add('OTP/mã xác thực');
  }

  return [...findings];
}

function buildSensitiveInputRefusal(findings: string[]): string {
  const labels = findings.length ? findings.join(', ') : 'thông tin nhạy cảm';
  return [
    `Mình không thể xử lý nội dung có ${labels}.`,
    'Bạn hãy xóa hoặc che các thông tin nhạy cảm như OTP, mật khẩu, private key, API key/token rồi gửi lại.',
  ].join('\n');
}

export async function runAiAssistantPipeline(
  req: IAiAssistantRequest,
  optionsOrReporter?: StageReporter | AiAssistantPipelineOptions,
): Promise<IAiAssistantResponse> {
  const { onStage, signal } = normalizePipelineOptions(optionsOrReporter);
  throwIfAborted(signal);
  onStage?.('init');
  const userId = req.userId?.trim();
  if (!userId) throw new Error('Thiếu userId');

  const message = req.message?.trim();
  if (!message) {
    throw new Error('Tin nhắn trống');
  }
  const tokenDecision = parseConfirmToken(message);
  throwIfAborted(signal);

  let threadId = req.threadId?.trim();
  if (!threadId) {
    threadId = await aiAssistantRepository.getOrCreateDefaultThreadId(userId);
  } else {
    await aiAssistantRepository.assertThreadOwnedByUser(userId, threadId);
  }
  throwIfAborted(signal);

  const sensitiveFindings = tokenDecision ? [] : detectSensitiveUserInput(message);
  if (sensitiveFindings.length > 0) {
    onStage?.('persist_user_message');
    const userRow = await aiAssistantRepository.appendMessage(
      threadId,
      'user',
      SENSITIVE_PLACEHOLDER,
    );
    await aiAssistantRepository.touchDefaultThread(userId);
    const reply = buildSensitiveInputRefusal(sensitiveFindings);
    onStage?.('persist_assistant_message');
    const assistantRow = await aiAssistantRepository.appendMessage(threadId, 'assistant', reply);
    await aiAssistantRepository.touchDefaultThread(userId);
    onStage?.('completed');
    return {
      reply,
      model: aiConfig.modelId,
      tokensUsed: 0,
      threadId,
      userMessageId: userRow.messageId,
      assistantMessageId: assistantRow.messageId,
    };
  }

  onStage?.('persist_user_message');
  const userVisibleMessage =
    tokenDecision?.decision === 'approve'
      ? 'đồng ý'
      : tokenDecision?.decision === 'reject'
        ? 'không'
        : message;
  const userRow = await aiAssistantRepository.appendMessage(threadId, 'user', userVisibleMessage);
  await aiAssistantRepository.touchDefaultThread(userId);
  throwIfAborted(signal);

  const persistAssistantAndBuildResponse = async (
    reply: string,
    model: string,
    tokensUsed: number,
    actions?: import('./ai.types.js').AiAssistantClientAction[],
  ): Promise<IAiAssistantResponse> => {
    onStage?.('persist_assistant_message');
    throwIfAborted(signal);
    const assistantRow = await aiAssistantRepository.appendMessage(
      threadId,
      'assistant',
      reply,
      actions,
    );
    try {
      onStage?.('embedding_reply');
      const vecA = await embedText(reply, signal);
      if (vecA.length > 0) {
        await upsertAiMessageVector(assistantRow.messageId, vecA, {
          userId,
          threadId,
          messageId: assistantRow.messageId,
          role: 'assistant',
          text: assistantRow.content,
          createdAt: assistantRow.createdAt,
        });
      }
    } catch (e) {
      if (isAbortLike(e)) throw e;
      /* optional */
    }
    await aiAssistantRepository.touchDefaultThread(userId);
    onStage?.('completed');
    return {
      reply,
      model,
      tokensUsed,
      threadId,
      userMessageId: userRow.messageId,
      assistantMessageId: assistantRow.messageId,
      ...(actions && actions.length ? { actions } : {}),
    };
  };

  const pending = await aiAssistantRepository.getPendingTool(threadId);
  throwIfAborted(signal);
  if (pending) {
    onStage?.('await_user_confirmation');
    if (tokenDecision && tokenDecision.pendingId !== pending.pendingId) {
      const confirmAction = getConfirmActionFromPending(pending);
      return persistAssistantAndBuildResponse(
        `${confirmAction.payload.question} Bấm "${confirmAction.payload.confirmText}" hoặc "${confirmAction.payload.cancelText}".`,
        aiConfig.modelId,
        0,
        [confirmAction],
      );
    }

    const approved =
      tokenDecision?.decision === 'approve' || (!tokenDecision && isAffirmative(message));
    const rejected =
      tokenDecision?.decision === 'reject' || (!tokenDecision && isNegative(message));

    if (approved) {
      onStage?.('tool_execution');
      throwIfAborted(signal);
      const claimed = await aiAssistantRepository.claimPendingTool(threadId, pending.pendingId);
      if (!claimed) {
        return persistAssistantAndBuildResponse(
          'Thao tác này đã được xử lý hoặc đã hết hiệu lực.',
          aiConfig.modelId,
          0,
        );
      }
      const exec = await executeAiToolCalls(
        userId,
        [{ name: pending.toolName, args: pending.toolArgs ?? {} }],
        { signal },
      );
      throwIfAborted(signal);
      const followPrompt = [
        `Kết quả công cụ:\n${exec.textForModel}`,
        'Tóm tắt gọn kết quả cho user bằng tiếng Việt. Nếu không có kết quả thì nói rõ.',
      ].join('\n\n');
      onStage?.('model_finalize');
      const summarized = await generateText(followPrompt, {
        systemPrompt: 'Bạn là trợ lý HAMTECH. Trả lời ngắn gọn, rõ ràng.',
        temperature: 0.2,
        maxTokens: 500,
        signal,
      });
      return persistAssistantAndBuildResponse(
        summarized.text.trim() || 'Tôi đã thực hiện thao tác theo yêu cầu.',
        summarized.model,
        summarized.tokensUsed ?? 0,
        exec.clientActions,
      );
    }
    if (rejected) {
      await aiAssistantRepository.clearPendingTool(threadId);
      return persistAssistantAndBuildResponse(
        'Đã hủy thao tác theo yêu cầu của bạn.',
        aiConfig.modelId,
        0,
      );
    }
    const confirmAction = getConfirmActionFromPending(pending);
    return persistAssistantAndBuildResponse(
      `${confirmAction.payload.question} Bấm "${confirmAction.payload.confirmText}" hoặc "${confirmAction.payload.cancelText}".`,
      aiConfig.modelId,
      0,
      [confirmAction],
    );
  }

  let ragBlock = '';
  try {
    throwIfAborted(signal);
    onStage?.('embedding_query');
    const vec = await embedText(message, signal);
    if (vec.length > 0) {
      throwIfAborted(signal);
      onStage?.('rag_search');
      const hits = await searchSimilarAiChunks({
        userId,
        threadId,
        vector: vec,
        limit: 6,
      });
      const useful = hits.filter((h) => h.text.length > 0);
      if (useful.length) {
        ragBlock = `\nĐoạn liên quan (RAG):\n${useful
          .map((h, i) => `${i + 1}. (${h.role}) ${truncateText(h.text, MAX_RAG_CHUNK_CHARS)}`)
          .join('\n')}\n`;
      }
      await upsertAiMessageVector(userRow.messageId, vec, {
        userId,
        threadId,
        messageId: userRow.messageId,
        role: 'user',
        text: userRow.content,
        createdAt: userRow.createdAt,
      });
    }
  } catch (e) {
    if (isAbortLike(e)) throw e;
    /* RAG / embedding optional */
  }

  onStage?.('load_history');
  throwIfAborted(signal);
  const history = await aiAssistantRepository.listRecentMessages(threadId, 36);
  const transcript = buildHistoryTranscript(history, 32);

  const locale = req.locale === 'en' ? 'en' : 'vi';
  const forceMessageSearchTool = looksLikeMessageSearchRequest(message);
  const toolDoc =
    locale === 'vi'
      ? [
          'Công cụ (toolCalls, tối đa 5):',
          '- search_messages: { "query": string }',
          '- search_users: { "query": string } - tìm người dùng có thể tìm bằng tên, email',
          '- search_users_contacts: { "query": string } — tìm kiếm chỉ bằng email hoặc số điện thoại',
          '- search_groups: { "query": string }',
          '- suggest_create_poll: { "conversationId"?: string, "question"?: string, "options"?: string[] }',
          '- suggest_open_direct_chat: { "otherUserId": string } — mở chat 1-1 (client)',
          '- invoke_secondary_model: { "prompt": string, "modelId"?: string } — gọi model phụ (nếu cấu hình)',
        ].join('\n')
      : [
          'Tools (toolCalls, max 5):',
          '- search_messages: { "query": string }',
          '- search_users: { "query": string }',
          '- search_users_contacts: { "query": string }',
          '- search_groups: { "query": string }',
          '- suggest_create_poll: { "conversationId"?, "question"?, "options"? }',
          '- suggest_open_direct_chat: { "otherUserId": string }',
          '- invoke_secondary_model: { "prompt": string, "modelId"?: string }',
        ].join('\n');

  const systemPrompt =
    locale === 'vi'
      ? [
          'Bạn là trợ lý HAMTECH trong app chat.',
          'Luôn trả lời trung thực; nếu thiếu dữ liệu hãy dùng tool hoặc hỏi ngắn.',
          forceMessageSearchTool
            ? 'Yêu cầu hiện tại là tìm tin nhắn: PHẢI gọi tool search_messages; không được trả lời chỉ dựa trên lịch sử/RAG.'
            : '',
          'Bạn PHẢI trả về đúng MỘT JSON hợp lệ (không markdown), schema:',
          '{"reply": string, "toolCalls": Array<{ "name": string, "args": object }>}',
          'toolCalls có thể là [].',
          toolDoc,
        ].join('\n')
      : [
          'You are HAMTECH AI assistant in a chat app.',
          forceMessageSearchTool
            ? 'The current request is a message search: you MUST call search_messages; do not answer only from history/RAG.'
            : '',
          'Return exactly ONE valid JSON object, schema:',
          '{"reply": string, "toolCalls": Array<{ "name": string, "args": object }>}',
          toolDoc,
        ].join('\n');

  const firstPrompt = [
    transcript ? `Lịch sử:\n${transcript}` : '',
    ragBlock,
    `Yêu cầu hiện tại của user: ${message}`,
    locale === 'vi' ? 'Trả về JSON như hướng dẫn.' : 'Return JSON as instructed.',
  ]
    .filter(Boolean)
    .join('\n\n');

  let totalTokens = 0;
  let modelUsed = aiConfig.modelId;

  onStage?.('model_reasoning');
  throwIfAborted(signal);
  const first = await generateText(firstPrompt, {
    systemPrompt,
    temperature: 0.25,
    maxTokens: 900,
    signal,
  });
  throwIfAborted(signal);
  totalTokens += first.tokensUsed ?? 0;
  modelUsed = first.model;

  let parsed = parseJsonLoose(first.text);
  let reply = typeof parsed?.reply === 'string' ? parsed.reply.trim() : '';
  const toolCalls = Array.isArray(parsed?.toolCalls) ? parsed!.toolCalls! : [];
  const allActions: import('./ai.types.js').AiAssistantClientAction[] = [];

  if (toolCalls.length > 0) {
    const normalized: AiToolCall[] = toolCalls
      .map((t) => ({
        name: String((t as { name?: unknown }).name ?? ''),
        args: (typeof (t as { args?: unknown }).args === 'object' && (t as { args?: unknown }).args
          ? ((t as { args: object }).args as Record<string, unknown>)
          : {}) as Record<string, unknown>,
      }))
      .filter((t) => t.name.length > 0);

    const extraCalls: AiToolCall[] = [];
    for (const t of normalized) {
      if (t.name === 'suggest_open_direct_chat') {
        const otherUserId = String(t.args.otherUserId ?? '').trim();
        if (otherUserId) {
          allActions.push({ type: 'open_direct_chat', payload: { otherUserId } });
        }
        continue;
      }
      if (t.name === 'open_search' || t.name === 'suggest_open_search') {
        const tab = String(t.args.tab ?? 'messages') as
          | 'messages'
          | 'users'
          | 'groups'
          | 'contacts';
        const query = String(t.args.query ?? '').trim();
        if (query) {
          const safeTab =
            tab === 'users' || tab === 'groups' || tab === 'contacts' ? tab : 'messages';
          allActions.push({ type: 'open_search', payload: { tab: safeTab, query } });
        }
        continue;
      }
      extraCalls.push(t);
    }

    const confirmCandidate = pickFirstConfirmTool(extraCalls);
    if (confirmCandidate) {
      onStage?.('await_user_confirmation');
      const pendingRecord = await aiAssistantRepository.setPendingTool(
        threadId,
        confirmCandidate.name,
        confirmCandidate.args ?? {},
      );
      const confirmAction = getConfirmActionFromPending(pendingRecord);
      return persistAssistantAndBuildResponse(
        `${confirmAction.payload.question} Bấm "${confirmAction.payload.confirmText}" hoặc "${confirmAction.payload.cancelText}".`,
        modelUsed,
        totalTokens,
        [confirmAction],
      );
    }

    onStage?.('tool_execution');
    throwIfAborted(signal);
    const exec = await executeAiToolCalls(userId, extraCalls, { signal });
    throwIfAborted(signal);
    allActions.push(...exec.clientActions);

    if (exec.textForModel.trim().length > 0) {
      onStage?.('model_finalize');
      const secondPrompt = [
        `Kết quả công cụ:\n${exec.textForModel}`,
        'Hãy tóm tắt ngắn gọn cho user (tiếng Việt nếu user dùng vi).',
        'Không nhắc UUID/id nội bộ; với người gửi hãy dùng tên hiển thị nếu có.',
        'Nếu có kết quả search_messages, hãy chọn tối đa 5 resultKey thật sự liên quan để hiển thị trên card.',
        'Trả về JSON: {"reply": string, "toolCalls": [], "messageResultKeys": string[]}',
      ].join('\n\n');
      const second = await generateText(secondPrompt, {
        systemPrompt:
          locale === 'vi'
            ? 'Bạn là trợ lý HAMTECH. Chỉ trả JSON {"reply","toolCalls","messageResultKeys"}. toolCalls luôn []. Không nhắc UUID/id nội bộ cho user.'
            : 'HAMTECH assistant. Output only JSON {"reply","toolCalls","messageResultKeys"}; toolCalls always []. Do not mention internal UUIDs to users.',
        temperature: 0.2,
        maxTokens: 700,
        signal,
      });
      throwIfAborted(signal);
      totalTokens += second.tokensUsed ?? 0;
      parsed = parseJsonLoose(second.text);
      reply = typeof parsed?.reply === 'string' ? parsed.reply.trim() : second.text.trim();
      const selectedMessageKeys = Array.isArray(parsed?.messageResultKeys)
        ? parsed.messageResultKeys.map((id) => String(id))
        : Array.isArray(parsed?.messageResultIds)
          ? parsed.messageResultIds.map((id) => String(id))
          : [];
      if (allActions.some((action) => action.type === 'show_message_results')) {
        allActions.splice(
          0,
          allActions.length,
          ...filterMessageResultActions(allActions, selectedMessageKeys),
        );
      }
    }
  }

  if (!reply) {
    reply =
      first.text.trim() ||
      (allActions.length > 0
        ? 'Đã chuẩn bị thao tác trên giao diện (xem các nút gợi ý nếu có).'
        : 'Không tạo được phản hồi.');
  }
  return persistAssistantAndBuildResponse(
    sanitizeInternalIdsForUser(reply),
    modelUsed,
    totalTokens,
    allActions,
  );
}
