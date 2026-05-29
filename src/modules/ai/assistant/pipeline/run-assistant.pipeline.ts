/**
 * @file Chứa pipeline chính để xử lý các yêu cầu của trợ lý AI.
 *
 * File này điều phối toàn bộ quy trình, từ việc nhận yêu cầu của người dùng,
 * xử lý thông qua mô hình ngôn ngữ lớn (LLM), thực thi các công cụ cần thiết,
 * và cuối cùng trả về một phản hồi cho người dùng. Nó quản lý các giai đoạn
 * như phát hiện đầu vào nhạy cảm, truy xuất thông tin (RAG), thực thi công cụ,
 * và tương tác với người dùng để xác nhận hành động.
 */

import { generateText } from '../../shared/llm/generate-text.js';
import { aiConfig } from '@/config/ai.js';
import type {
  IAiAssistantRequest,
  IAiAssistantResponse,
} from '../../shared/types/assistant.types.js';
import type { AiAssistantClientAction } from '../../shared/types/assistant.types.js';
import { aiAssistantRepository } from '../assistant.repository.js';
import { embedText } from '../../shared/llm/embedding.service.js';
import { searchSimilarAiChunks, upsertAiMessageVector } from '../../shared/rag/qdrant.client.js';
import { executeAiToolCalls, type AiToolCall } from '../tools/execute-tools.js';
import {
  getConfirmActionFromPending,
  isAffirmative,
  isNegative,
  parseConfirmToken,
  pickFirstConfirmTool,
} from '../tools/confirmation.js';
import { warnIfSecondaryModelMisconfigured } from '../../shared/llm/bedrock-models.js';
import { planAiToolCalls } from '../tools/tool-call-planner.js';
import { buildToolDoc, getActivePolicyHints } from '../tools/tool-registry.js';
import {
  buildAssistantConfirmFinalizeSystemPrompt,
  buildAssistantFinalizeSystemPrompt,
  buildAssistantSystemPrompt,
} from './pipeline.prompts.js';
import {
  type LlmJsonShape,
  parseJsonLoose,
  sanitizeInternalIdsForUser,
  convertImageLinksToMarkdownImages,
  filterCommunityResultActions,
  filterMessageResultActions,
  detectSensitiveUserInput,
  buildSensitiveInputRefusal,
  truncateText,
  prepareHistoryForTurn,
  filterRagHitsForTurn,
  buildReAskInstruction,
} from './pipeline.helpers.js';
import {
  type AiAssistantStage,
  MAX_RAG_CHUNK_CHARS,
  SENSITIVE_PLACEHOLDER,
} from './pipeline.constants.js';

export type { AiAssistantStage } from './pipeline.constants.js';

/**
 * Type cho hàm báo cáo tiến trình của pipeline, cho phép theo dõi các giai đoạn xử lý.
 * @param stage Giai đoạn hiện tại của pipeline.
 * @param detail Thông tin chi tiết (tùy chọn) về giai đoạn.
 */
type StageReporter = (stage: AiAssistantStage, detail?: string) => void;

/**
 * Lỗi được ném ra khi một yêu cầu trợ lý AI bị hủy bỏ, thường là do AbortSignal.
 */
export class AiAssistantCancelledError extends Error {
  constructor() {
    super('AI request was cancelled');
    this.name = 'AiAssistantCancelledError';
  }
}

/**
 * Tùy chọn cấu hình cho pipeline trợ lý AI.
 */
export type AiAssistantPipelineOptions = {
  /** Hàm callback để báo cáo các giai đoạn xử lý. */
  onStage?: StageReporter;
  /** Signal để hủy bỏ yêu cầu đang xử lý. */
  signal?: AbortSignal;
};

/**
 * Chuẩn hóa các tùy chọn đầu vào cho pipeline.
 * @param optionsOrReporter Có thể là một hàm reporter hoặc một đối tượng tùy chọn đầy đủ.
 * @returns Một đối tượng AiAssistantPipelineOptions đã được chuẩn hóa.
 */
function normalizePipelineOptions(
  optionsOrReporter?: StageReporter | AiAssistantPipelineOptions,
): AiAssistantPipelineOptions {
  return typeof optionsOrReporter === 'function'
    ? { onStage: optionsOrReporter }
    : (optionsOrReporter ?? {});
}

/**
 * Kiểm tra xem một lỗi có phải là lỗi hủy bỏ (abort) hay không.
 * @param error Lỗi cần kiểm tra.
 * @returns `true` nếu lỗi là do hủy bỏ, ngược lại `false`.
 */
function isAbortLike(error: unknown): boolean {
  if (error instanceof AiAssistantCancelledError) return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  return false;
}

/**
 * Hàm tiện ích để kiểm tra xem một lỗi có phải là do hủy bỏ pipeline trợ lý AI hay không.
 * @param error Lỗi cần kiểm tra.
 * @returns `true` nếu lỗi là do hủy bỏ.
 */
export function isAiAssistantCancellation(error: unknown): boolean {
  return isAbortLike(error);
}

/**
 * Ném ra lỗi AiAssistantCancelledError nếu AbortSignal đã được kích hoạt.
 * @param signal AbortSignal để kiểm tra.
 * @throws {AiAssistantCancelledError} Nếu yêu cầu đã bị hủy.
 */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AiAssistantCancelledError();
  }
}

/**
 * Chạy pipeline xử lý chính cho trợ lý AI.
 *
 * Hàm này điều phối toàn bộ quy trình xử lý một yêu cầu từ người dùng:
 * 1. Khởi tạo và xác thực đầu vào (userId, message).
 * 2. Phát hiện và xử lý nội dung nhạy cảm.
 * 3. Ghi lại tin nhắn của người dùng vào lịch sử.
 * 4. Xử lý các hành động đang chờ xác nhận từ người dùng.
 * 5. Tải lịch sử cuộc trò chuyện.
 * 6. Thực hiện Retrieval-Augmented Generation (RAG) để lấy ngữ cảnh liên quan.
 * 7. Gọi mô hình LLM để phân tích và quyết định hành động (tool call hoặc trả lời trực tiếp).
 * 8. Thực thi các công cụ nếu cần.
 * 9. Gọi lại mô hình LLM để tổng hợp kết quả từ công cụ (nếu có).
 * 10. Ghi lại phản hồi của trợ lý và trả về cho người dùng.
 *
 * @param req Đối tượng yêu cầu trợ lý AI.
 * @param optionsOrReporter Tùy chọn hoặc hàm callback để theo dõi tiến trình.
 * @returns Một promise phân giải thành đối tượng phản hồi của trợ lý AI.
 */
export async function runAiAssistantPipeline(
  req: IAiAssistantRequest,
  optionsOrReporter?: StageReporter | AiAssistantPipelineOptions,
): Promise<IAiAssistantResponse> {
  const { onStage, signal } = normalizePipelineOptions(optionsOrReporter);
  throwIfAborted(signal);
  onStage?.('init');
  warnIfSecondaryModelMisconfigured();
  const userId = req.userId?.trim();
  if (!userId) throw new Error('Thiếu userId');

  const message = req.message?.trim();
  if (!message) {
    throw new Error('Tin nhắn trống');
  }
  // Phân tích tin nhắn để xem có phải là token xác nhận hành động không.
  const tokenDecision = parseConfirmToken(message);
  throwIfAborted(signal);

  // Lấy hoặc tạo threadId cho cuộc trò chuyện.
  let threadId = req.threadId?.trim();
  if (!threadId) {
    threadId = await aiAssistantRepository.getOrCreateDefaultThreadId(userId);
  } else {
    await aiAssistantRepository.assertThreadOwnedByUser(userId, threadId);
  }
  throwIfAborted(signal);

  // Phát hiện nội dung nhạy cảm trong tin nhắn của người dùng.
  const sensitiveFindings = tokenDecision ? [] : detectSensitiveUserInput(message);
  if (sensitiveFindings.length > 0) {
    onStage?.('persist_user_message');
    // Thay thế tin nhắn nhạy cảm bằng một placeholder trước khi lưu.
    const userRow = await aiAssistantRepository.appendMessage(
      threadId,
      'user',
      SENSITIVE_PLACEHOLDER,
    );
    await aiAssistantRepository.touchDefaultThread(userId);
    // Xây dựng và trả về một phản hồi từ chối.
    const reply = buildSensitiveInputRefusal(sensitiveFindings);
    onStage?.('persist_assistant_message');
    const assistantRow = await aiAssistantRepository.appendMessage(threadId, 'assistant', reply);
    await aiAssistantRepository.touchDefaultThread(userId);
    onStage?.('completed');

    // Dừng xử lý và trả về phản hồi từ chối.
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
  // Chuẩn bị tin nhắn của người dùng để hiển thị (ví dụ: "đồng ý" thay vì token).
  const userVisibleMessage =
    tokenDecision?.decision === 'approve'
      ? 'đồng ý'
      : tokenDecision?.decision === 'reject'
        ? 'không'
        : message;
  const userRow = await aiAssistantRepository.appendMessage(threadId, 'user', userVisibleMessage);
  await aiAssistantRepository.touchDefaultThread(userId);
  throwIfAborted(signal);

  /**
   * Hàm nội bộ để lưu tin nhắn của trợ lý và xây dựng đối tượng phản hồi cuối cùng.
   * @param reply Nội dung phản hồi của trợ lý.
   * @param model ID của mô hình đã sử dụng.
   * @param tokensUsed Số lượng token đã tiêu thụ.
   * @param actions (Tùy chọn) Các hành động phía client cần thực hiện.
   * @returns Đối tượng phản hồi hoàn chỉnh.
   */
  const persistAssistantAndBuildResponse = async (
    reply: string,
    model: string,
    tokensUsed: number,
    actions?: AiAssistantClientAction[],
  ): Promise<IAiAssistantResponse> => {
    onStage?.('persist_assistant_message');
    throwIfAborted(signal);
    // Chuẩn hóa và làm sạch phản hồi trước khi gửi cho người dùng.
    const userFacingReply = convertImageLinksToMarkdownImages(sanitizeInternalIdsForUser(reply));
    const assistantRow = await aiAssistantRepository.appendMessage(
      threadId,
      'assistant',
      userFacingReply,
      actions,
    );
    try {
      // Tạo embedding cho phản hồi của trợ lý để sử dụng trong RAG sau này.
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
      /* embedding là tùy chọn, bỏ qua nếu lỗi */
    }
    await aiAssistantRepository.touchDefaultThread(userId);
    onStage?.('completed');
    return {
      reply: userFacingReply,
      model,
      tokensUsed,
      threadId,
      userMessageId: userRow.messageId,
      assistantMessageId: assistantRow.messageId,
      ...(actions && actions.length ? { actions } : {}),
    };
  };

  // Kiểm tra xem có công cụ nào đang chờ xác nhận từ người dùng không.
  const pending = await aiAssistantRepository.getPendingTool(threadId);
  throwIfAborted(signal);
  if (pending) {
    onStage?.('await_user_confirmation');
    // Nếu người dùng gửi một token xác nhận không khớp, yêu cầu lại.
    if (tokenDecision && tokenDecision.pendingId !== pending.pendingId) {
      const confirmAction = getConfirmActionFromPending(pending);
      return persistAssistantAndBuildResponse(
        `${confirmAction.payload.question} Bấm "${confirmAction.payload.confirmText}" hoặc "${confirmAction.payload.cancelText}".`,
        aiConfig.modelId,
        0,
        [confirmAction],
      );
    }

    // Kiểm tra xem người dùng đã đồng ý hay từ chối.
    const approved =
      tokenDecision?.decision === 'approve' || (!tokenDecision && isAffirmative(message));
    const rejected =
      tokenDecision?.decision === 'reject' || (!tokenDecision && isNegative(message));

    if (approved) {
      onStage?.('tool_execution');
      throwIfAborted(signal);
      // Đánh dấu công cụ đang chờ là đã được xử lý.
      const claimed = await aiAssistantRepository.claimPendingTool(threadId, pending.pendingId);
      if (!claimed) {
        return persistAssistantAndBuildResponse(
          'Thao tác này đã được xử lý hoặc đã hết hiệu lực.',
          aiConfig.modelId,
          0,
        );
      }
      // Thực thi công cụ đã được xác nhận.
      const exec = await executeAiToolCalls(
        userId,
        [{ name: pending.toolName, args: pending.toolArgs ?? {} }],
        { signal },
      );
      throwIfAborted(signal);
      // Tạo prompt để LLM tóm tắt kết quả.
      const followPrompt = [
        `Kết quả công cụ:\n${exec.textForModel}`,
        'Tóm tắt gọn kết quả cho user bằng tiếng Việt. Nếu không có kết quả thì nói rõ.',
      ].join('\n\n');
      onStage?.('model_finalize');
      // Gọi LLM để tóm tắt.
      const summarized = await generateText(followPrompt, {
        systemPrompt: buildAssistantConfirmFinalizeSystemPrompt(req.locale === 'en' ? 'en' : 'vi'),
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
      // Nếu người dùng từ chối, xóa công cụ đang chờ.
      await aiAssistantRepository.clearPendingTool(threadId);
      return persistAssistantAndBuildResponse(
        'Đã hủy thao tác theo yêu cầu của bạn.',
        aiConfig.modelId,
        0,
      );
    }
    // Nếu không phải đồng ý hay từ chối, yêu cầu lại xác nhận.
    const confirmAction = getConfirmActionFromPending(pending);
    return persistAssistantAndBuildResponse(
      `${confirmAction.payload.question} Bấm "${confirmAction.payload.confirmText}" hoặc "${confirmAction.payload.cancelText}".`,
      aiConfig.modelId,
      0,
      [confirmAction],
    );
  }

  onStage?.('load_history');
  throwIfAborted(signal);
  // Tải lịch sử tin nhắn gần đây và chuẩn bị cho lượt hiện tại.
  const history = await aiAssistantRepository.listRecentMessages(threadId, 36);
  const { transcript, isReAsk } = prepareHistoryForTurn(history, {
    excludeMessageId: userRow.messageId,
    currentMessage: message,
    maxLines: 32,
  });

  let ragBlock = '';
  try {
    // Thực hiện RAG: tạo embedding cho câu hỏi và tìm kiếm các đoạn văn bản tương tự.
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
      // Lọc các kết quả RAG hữu ích cho lượt hiện tại.
      const useful = filterRagHitsForTurn(
        hits.filter((h) => h.text.length > 0),
        message,
        isReAsk,
      );
      if (useful.length) {
        ragBlock = `\nĐoạn liên quan (RAG):\n${useful
          .map((h, i) => `${i + 1}. (${h.role}) ${truncateText(h.text, MAX_RAG_CHUNK_CHARS)}`)
          .join('\n')}\n`;
      }
      // Lưu vector của tin nhắn người dùng để sử dụng trong tương lai.
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
    /* RAG / embedding là tùy chọn, bỏ qua nếu lỗi */
  }

  const locale = req.locale === 'en' ? 'en' : 'vi';
  // Lấy các gợi ý chính sách và tài liệu công cụ để đưa vào system prompt.
  const policyHints = getActivePolicyHints(message, locale);
  const toolDoc = buildToolDoc(locale);

  // Xây dựng system prompt cho LLM.
  const systemPrompt = buildAssistantSystemPrompt({
    locale,
    toolDoc,
    policyHints,
  });

  // Xây dựng prompt đầu tiên bao gồm lịch sử, RAG và yêu cầu hiện tại.
  const firstPrompt = [
    transcript ? `Lịch sử:\n${transcript}` : '',
    ragBlock,
    isReAsk ? buildReAskInstruction(locale) : '',
    `Yêu cầu hiện tại của user: ${message}`,
    locale === 'vi' ? 'Trả về JSON như hướng dẫn.' : 'Return JSON as instructed.',
  ]
    .filter(Boolean)
    .join('\n\n');

  let totalTokens = 0;
  let modelUsed = aiConfig.modelId;

  onStage?.('model_reasoning');
  throwIfAborted(signal);

  /**
   * Bắt đầu thực hiện pipeline chính:
   * gọi LLM để phân tích yêu cầu và quyết
   * định hành động tiếp theo (có thể là trả lời trực tiếp hoặc gọi công cụ).
   **/

  // Gọi LLM lần đầu để phân tích và quyết định hành động.
  const first = await generateText(firstPrompt, {
    systemPrompt,
    temperature: isReAsk ? 0.45 : 0.25,
    maxTokens: 900,
    signal,
  });
  throwIfAborted(signal);
  totalTokens += first.tokensUsed ?? 0;
  modelUsed = first.model;

  // Phân tích phản hồi JSON từ LLM.
  let parsed = parseJsonLoose(first.text);
  let reply = typeof parsed?.reply === 'string' ? parsed.reply.trim() : '';
  const toolCalls = Array.isArray(parsed?.toolCalls) ? parsed!.toolCalls! : [];
  const allActions: AiAssistantClientAction[] = [];

  const normalized: AiToolCall[] = planAiToolCalls(message, toolCalls);

  if (normalized.length > 0) {
    const extraCalls: AiToolCall[] = [];
    // Xử lý các tool call không cần thực thi phía server (mà là action phía client).
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

    // Kiểm tra xem có công cụ nào cần xác nhận từ người dùng không.
    const confirmCandidate = pickFirstConfirmTool(extraCalls);
    if (confirmCandidate) {
      onStage?.('await_user_confirmation');
      // Lưu công cụ cần xác nhận và yêu cầu người dùng.
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
    // Thực thi các công cụ cần chạy phía server.
    const exec = await executeAiToolCalls(userId, extraCalls, { signal });
    throwIfAborted(signal);
    allActions.push(...exec.clientActions);

    if (exec.textForModel.trim().length > 0) {
      onStage?.('model_finalize');
      // Xây dựng prompt thứ hai để LLM tóm tắt kết quả từ công cụ.
      const secondPrompt = [
        `Kết quả công cụ:\n${exec.textForModel}`,
        'Hãy tóm tắt ngắn gọn cho user (tiếng Việt nếu user dùng vi).',
        'Không nhắc UUID/id nội bộ; với người gửi hãy dùng tên hiển thị nếu có.',
        'Ảnh đại diện: dùng ![](url), không dùng [Link ảnh](url).',
        'Nếu có kết quả search_messages, hãy chọn tối đa 5 resultKey thật sự liên quan để hiển thị trên card.',
        'Nếu có kết quả search_communities, hãy chọn resultKey cộng đồng bạn thật sự giới thiệu vào communityResultKeys; nếu chỉ giới thiệu 1 cộng đồng thì chỉ chọn 1 key.',
        'search_communities: chỉ mô tả cộng đồng trong JSON tool; không bịa tên; nếu rỗng thì nói chưa có trong hệ thống.',
        'Trả về JSON: {"reply": string, "toolCalls": [], "messageResultKeys": string[], "communityResultKeys": string[]}',
      ].join('\n\n');
      // Gọi LLM lần thứ hai.
      const second = await generateText(secondPrompt, {
        systemPrompt: buildAssistantFinalizeSystemPrompt(locale),
        temperature: 0.2,
        maxTokens: 700,
        signal,
      });
      throwIfAborted(signal);
      totalTokens += second.tokensUsed ?? 0;
      parsed = parseJsonLoose(second.text);
      reply = typeof parsed?.reply === 'string' ? parsed.reply.trim() : second.text.trim();
      // Lọc các key tin nhắn được chọn để hiển thị trên card kết quả.
      const selectedMessageKeys = Array.isArray(parsed?.messageResultKeys)
        ? parsed.messageResultKeys.map((id) => String(id))
        : Array.isArray(parsed?.messageResultIds)
          ? parsed.messageResultIds.map((id) => String(id))
          : [];
      const selectedCommunityKeys = Array.isArray(parsed?.communityResultKeys)
        ? parsed.communityResultKeys.map((id) => String(id))
        : Array.isArray(parsed?.communityResultIds)
          ? parsed.communityResultIds.map((id) => String(id))
          : [];
      if (allActions.some((action) => action.type === 'show_message_results')) {
        allActions.splice(
          0,
          allActions.length,
          ...filterMessageResultActions(allActions, selectedMessageKeys),
        );
      }
      if (allActions.some((action) => action.type === 'show_community_results')) {
        allActions.splice(
          0,
          allActions.length,
          ...filterCommunityResultActions(allActions, selectedCommunityKeys),
        );
      }
    }
  }

  // Nếu không có phản hồi nào được tạo, sử dụng phản hồi mặc định.
  if (!reply) {
    reply =
      first.text.trim() ||
      (allActions.length > 0
        ? 'Đã chuẩn bị thao tác trên giao diện (xem các nút gợi ý nếu có).'
        : 'Không tạo được phản hồi.');
  }
  // Trả về phản hồi cuối cùng cho người dùng.
  return persistAssistantAndBuildResponse(reply, modelUsed, totalTokens, allActions);
}
