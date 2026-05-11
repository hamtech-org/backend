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

type LlmJsonShape = {
  reply?: string;
  toolCalls?: AiToolCall[];
};

function parseJsonLoose(text: string): LlmJsonShape | null {
  const t = text.trim();
  if (!t) return null;
  try {
    return JSON.parse(t) as LlmJsonShape;
  } catch {
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1)) as LlmJsonShape;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function buildHistoryTranscript(
  rows: Array<{ role: string; content: string }>,
  maxLines: number,
): string {
  const slice = rows.slice(-maxLines);
  return slice.map((r) => `${r.role === 'assistant' ? 'AI' : 'User'}: ${r.content}`).join('\n');
}

export async function runAiAssistantPipeline(
  req: IAiAssistantRequest,
  onStage?: StageReporter,
): Promise<IAiAssistantResponse> {
  onStage?.('init');
  const userId = req.userId?.trim();
  if (!userId) throw new Error('Thiếu userId');

  const message = req.message?.trim();
  if (!message) {
    throw new Error('Tin nhắn trống');
  }
  const tokenDecision = parseConfirmToken(message);

  let threadId = req.threadId?.trim();
  if (!threadId) {
    threadId = await aiAssistantRepository.getOrCreateDefaultThreadId(userId);
  } else {
    await aiAssistantRepository.assertThreadOwnedByUser(userId, threadId);
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

  const persistAssistantAndBuildResponse = async (
    reply: string,
    model: string,
    tokensUsed: number,
    actions?: import('./ai.types.js').AiAssistantClientAction[],
  ): Promise<IAiAssistantResponse> => {
    onStage?.('persist_assistant_message');
    const assistantRow = await aiAssistantRepository.appendMessage(threadId, 'assistant', reply);
    try {
      onStage?.('embedding_reply');
      const vecA = await embedText(reply);
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
    } catch {
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
      const exec = await executeAiToolCalls(userId, [
        { name: pending.toolName, args: pending.toolArgs ?? {} },
      ]);
      await aiAssistantRepository.clearPendingTool(threadId);
      const followPrompt = [
        `Kết quả công cụ:\n${exec.textForModel}`,
        'Tóm tắt gọn kết quả cho user bằng tiếng Việt. Nếu không có kết quả thì nói rõ.',
      ].join('\n\n');
      onStage?.('model_finalize');
      const summarized = await generateText(followPrompt, {
        systemPrompt: 'Bạn là trợ lý HAMTECH. Trả lời ngắn gọn, rõ ràng.',
        temperature: 0.2,
        maxTokens: 500,
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
    onStage?.('embedding_query');
    const vec = await embedText(message);
    if (vec.length > 0) {
      onStage?.('rag_search');
      const hits = await searchSimilarAiChunks({
        userId,
        threadId,
        vector: vec,
        limit: 6,
      });
      const useful = hits.filter((h) => h.text.length > 0);
      if (useful.length) {
        ragBlock = `\nĐoạn liên quan (RAG):\n${useful.map((h, i) => `${i + 1}. (${h.role}) ${h.text}`).join('\n')}\n`;
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
  } catch {
    /* RAG / embedding optional */
  }

  onStage?.('load_history');
  const history = await aiAssistantRepository.listRecentMessages(threadId, 36);
  const transcript = buildHistoryTranscript(history, 32);

  const locale = req.locale === 'en' ? 'en' : 'vi';
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
          'Bạn PHẢI trả về đúng MỘT JSON hợp lệ (không markdown), schema:',
          '{"reply": string, "toolCalls": Array<{ "name": string, "args": object }>}',
          'toolCalls có thể là [].',
          toolDoc,
        ].join('\n')
      : [
          'You are HAMTECH AI assistant in a chat app.',
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
  const first = await generateText(firstPrompt, {
    systemPrompt,
    temperature: 0.25,
    maxTokens: 900,
  });
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
    const exec = await executeAiToolCalls(userId, extraCalls);
    allActions.push(...exec.clientActions);

    if (exec.textForModel.trim().length > 0) {
      onStage?.('model_finalize');
      const secondPrompt = [
        `Kết quả công cụ:\n${exec.textForModel}`,
        'Hãy tóm tắt ngắn gọn cho user (tiếng Việt nếu user dùng vi).',
        'Trả về JSON: {"reply": string, "toolCalls": []}',
      ].join('\n\n');
      const second = await generateText(secondPrompt, {
        systemPrompt:
          locale === 'vi'
            ? 'Bạn là trợ lý HAMTECH. Chỉ trả JSON {"reply","toolCalls"}. toolCalls luôn [].'
            : 'HAMTECH assistant. Output only JSON {"reply","toolCalls"}; toolCalls always [].',
        temperature: 0.2,
        maxTokens: 700,
      });
      totalTokens += second.tokensUsed ?? 0;
      parsed = parseJsonLoose(second.text);
      reply = typeof parsed?.reply === 'string' ? parsed.reply.trim() : second.text.trim();
    }
  }

  if (!reply) {
    reply =
      first.text.trim() ||
      (allActions.length > 0
        ? 'Đã chuẩn bị thao tác trên giao diện (xem các nút gợi ý nếu có).'
        : 'Không tạo được phản hồi.');
  }
  return persistAssistantAndBuildResponse(reply, modelUsed, totalTokens, allActions);
}
