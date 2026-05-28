import type {
  IAiSuggestRequest,
  IAiSuggestResponse,
  IAiChatbotRequest,
  IAiChatbotResponse,
  IAiSentimentResult,
  IAiGeneratePostRequest,
  IAiGeneratePostResponse,
  IAiSuggestReplyContextRequest,
  IAiSuggestReplyContextResponse,
  IAiGroupSummaryRequest,
  IAiGroupSummaryResponse,
  IAiAssistantRequest,
  IAiAssistantResponse,
} from './ai.types.js';
import { aiConfig } from '@/config/ai.js';
import { conversationRepository } from '@/modules/chat/conversation/conversation.repository.js';
import { messageUserHideRepository } from '@/modules/chat/message/message-user-hide.repository.js';
import { groupRecapSessionService } from '@/modules/chat/recap/recap-session.service.js';
import type { IMessage } from '@/modules/chat/shared/chat.types.js';
import {
  attachSenderDisplayNames,
  filterMessagesByJoinHistoryCutoff,
  isMessageHiddenFromViewer,
  resolveMessageHistoryMinCreatedAtMs,
} from '@/modules/chat/shared/chat.helpers.js';
import { ForbiddenError } from '@/shared/utils/errors.js';
import { generateText } from './ai-generate-text.js';
import type { AiGenerateTextResult } from './ai-generate-text.js';
import { runAiAssistantPipeline } from './ai-assistant.pipeline.js';
import { writeAiUnreadSummaryTranscriptLog } from './ai-unread-summary.logger.js';

export { generateText } from './ai-generate-text.js';
export type { AiGenerateTextOptions, AiGenerateTextResult } from './ai-generate-text.js';

const isSummarizableGroupMessage = (m: IMessage): boolean => {
  if (m.isRecalled || m.isDeleted) return false;
  if ((m.type as string) === 'system' || (m as { position?: string }).position === 'center') {
    return false;
  }
  const content = String((m as { content?: unknown }).content ?? '').trim();
  return content.length > 0;
};

const renderGroupTranscript = (messages: IMessage[]): string =>
  messages
    .map((m) => {
      const name = (m.senderDisplayName ?? '').trim();
      const speaker = name.length ? name : 'người dùng';
      const text = String((m as { content?: unknown }).content ?? '').trim();
      return `${speaker}: ${text}`;
    })
    .join('\n');

const EMPTY_UNREAD_SUMMARY_SENTINELS = new Set([
  'Không có tin nhắn chưa đọc phù hợp để tóm tắt.',
  'Có tin nhắn chưa đọc nhưng chưa có đủ nội dung văn bản để tóm tắt.',
]);

const isInvalidUnreadSummaryForTranscript = (
  unreadSummary: string,
  unreadMessages: IMessage[],
): boolean => {
  const normalized = unreadSummary.trim();
  if (unreadMessages.length === 0) return false;
  return normalized.length === 0 || EMPTY_UNREAD_SUMMARY_SENTINELS.has(normalized);
};

const generateUnreadSummaryFromTranscript = async (
  unreadTranscript: string,
): Promise<AiGenerateTextResult> =>
  generateText(
    [
      'Hãy chỉ tóm tắt phần transcript tin nhắn chưa đọc bên dưới.',
      'Yêu cầu:',
      '- Transcript này có nội dung thật, không được trả lời rằng không có tin nhắn chưa đọc.',
      '- Trả về 2-5 bullet ngắn bằng tiếng Việt.',
      '- Không thêm thông tin ngoài transcript.',
      '',
      'Transcript tin nhắn chưa đọc:',
      unreadTranscript,
    ].join('\n'),
    {
      systemPrompt:
        'Bạn là trợ lý tóm tắt tin nhắn chưa đọc. Chỉ trả về phần tóm tắt ngắn bằng tiếng Việt.',
    },
  );

export const aiService = {
  suggestContent: async (request: IAiSuggestRequest): Promise<IAiSuggestResponse> => {
    const topics = (request.topics ?? []).map((t) => t.trim()).filter(Boolean);
    const toneByType: Record<IAiSuggestRequest['type'], string> = {
      reply:
        request.language === 'vi'
          ? 'tự nhiên, thân thiện, đúng kiểu nhắn tin'
          : 'natural, friendly, chat-like',
      post: request.language === 'vi' ? 'rõ ràng, mạch lạc' : 'clear, coherent',
      caption: request.language === 'vi' ? 'ngắn gọn, gọn ý' : 'short, concise',
    };

    const kindByType: Record<IAiSuggestRequest['type'], string> = {
      reply: request.language === 'vi' ? 'câu nhắn' : 'message',
      post: request.language === 'vi' ? 'câu/đoạn' : 'sentence/paragraph',
      caption: request.language === 'vi' ? 'caption' : 'caption',
    };

    const prompt =
      request.language === 'vi'
        ? [
            `Câu gốc:`,
            request.context.trim(),
            '',
            `Nhiệm vụ: Viết lại 5 ${kindByType[request.type]} có ý NGANG/ TƯƠNG ĐỒNG với câu gốc (paraphrase).`,
            `- Giữ nguyên ý chính, không đổi nghĩa.`,
            `- Có thể mở rộng nhẹ cho tự nhiên (từ đệm như: "á", "nha", "ạ", "một xíu"...), nhưng không được thêm thông tin sự kiện mới (địa điểm, thời gian, người, hành động...) nếu câu gốc không có.`,
            `- Không lặp ý giữa các gợi ý.`,
            `- Ngữ điệu/giọng văn phải phù hợp theo topics và type.`,
            '',
            `Type: ${request.type}`,
            `Topics: ${topics.length ? topics.join(', ') : '(không có)'}`,
            `Style: ${toneByType[request.type]}`,
            '',
            `Trả về đúng JSON theo schema: {"suggestions": string[]}`,
          ].join('\n')
        : [
            `Original sentence:`,
            request.context.trim(),
            '',
            `Task: Write 5 ${kindByType[request.type]} paraphrases that keep the SAME meaning as the original sentence.`,
            `- Preserve the core meaning; do not change intent.`,
            `- You may add light conversational fillers, but do NOT add new factual details (place, time, people, actions...) that are not in the original.`,
            `- No duplicates.`,
            `- Match tone/style by topics and type.`,
            '',
            `Type: ${request.type}`,
            `Topics: ${topics.length ? topics.join(', ') : '(none)'}`,
            `Style: ${toneByType[request.type]}`,
            '',
            `Return strictly JSON with schema: {"suggestions": string[]}`,
          ].join('\n');

    const { text, model, tokensUsed } = await generateText(prompt, {
      systemPrompt:
        request.language === 'vi'
          ? 'Bạn là trợ lý viết lại câu (paraphrase). Nhiệm vụ là tạo các câu tương đồng ý theo topics/type. Không đổi nghĩa, không bịa thêm chi tiết mới. Chỉ trả JSON hợp lệ.'
          : 'You rewrite sentences (paraphrase). Keep the same meaning, follow topics/type, do not add new facts. Output only valid JSON.',
    });

    let suggestions: string[] = [];
    try {
      const parsed = JSON.parse(text) as { suggestions?: unknown };
      if (Array.isArray(parsed.suggestions)) {
        suggestions = parsed.suggestions.map((s) => String(s).trim()).filter(Boolean);
      }
    } catch {
      suggestions = text
        .split('\n')
        .map((s) => s.replace(/^\s*[-*•\d.]+\s*/, '').trim())
        .filter(Boolean);
    }

    if (suggestions.length > 5) suggestions = suggestions.slice(0, 5);

    return {
      suggestions,
      model,
      tokensUsed: tokensUsed ?? 0,
    };
  },

  /**
   * Gợi ý câu trả lời (phong cách bạn bè) dựa trên ngữ cảnh hội thoại quanh một tin nhắn anchor.
   * Client gửi: meUserId, theirUserId, conversationId, anchorMessageId.
   * Backend sẽ tự lấy window tin nhắn quanh anchor từ DynamoDB.
   */
  suggestReplyFromContext: async (
    request: IAiSuggestReplyContextRequest,
  ): Promise<IAiSuggestReplyContextResponse> => {
    const count = Math.min(Math.max(1, request.count ?? 5), 5);
    const windowBefore = Math.min(Math.max(0, request.windowBefore ?? 20), 60);
    const windowAfter = Math.min(Math.max(0, request.windowAfter ?? 5), 30);

    const ctx = await conversationRepository.getMessageContext(
      request.conversationId,
      request.anchorMessageId,
      {
        before: windowBefore,
        after: windowAfter,
        onlyBetweenUsers: { meUserId: request.meUserId, theirUserId: request.theirUserId },
      },
    );

    if (ctx.anchor.senderId !== request.theirUserId) {
      throw new Error('Anchor message is not from theirUserId');
    }

    const renderLine = (m: IMessage, isAnchor: boolean) => {
      const speaker = m.senderId === request.meUserId ? 'Mình' : 'Bạn';
      const content = String((m as any).content ?? '').trim();
      const safe = content.length ? content : '(không có nội dung)';
      return isAnchor ? `[ANCHOR] ${speaker}: ${safe}` : `${speaker}: ${safe}`;
    };

    const transcript = [...ctx.before, ctx.anchor, ...ctx.after]
      .map((m) => renderLine(m, m.messageId === ctx.anchor.messageId))
      .join('\n');

    const anchorLine = renderLine(ctx.anchor, true);

    const prompt = [
      `Bạn đang soạn tin nhắn trả lời theo phong cách bạn bè.`,
      `Câu cần trả lời nhất (ANCHOR):`,
      anchorLine,
      ``,
      `Dựa trên transcript dưới đây, hãy đề xuất ${count} câu trả lời NGẮN để "Mình" trả lời "Bạn".`,
      `Yêu cầu: ưu tiên trả lời đúng trọng tâm ANCHOR; đúng ngữ cảnh, tự nhiên, thân thiện; không bịa thông tin mới; nếu thiếu thông tin thì hỏi 1 câu ngắn để làm rõ.`,
      ``,
      `Transcript:`,
      transcript,
      ``,
      `Trả về đúng JSON theo schema: {"suggestions": string[]}`,
    ].join('\n');

    const { text, model, tokensUsed } = await generateText(prompt, {
      systemPrompt:
        'Bạn là trợ lý soạn tin nhắn kiểu bạn bè. Luôn ưu tiên trả lời đúng trọng tâm ANCHOR. Không bịa chi tiết mới. Chỉ trả JSON hợp lệ theo schema {"suggestions": string[]}.',
    });

    let suggestions: string[] = [];
    try {
      const parsed = JSON.parse(text) as { suggestions?: unknown };
      if (Array.isArray(parsed.suggestions)) {
        suggestions = parsed.suggestions.map((s) => String(s).trim()).filter(Boolean);
      }
    } catch {
      suggestions = text
        .split('\n')
        .map((s) => s.replace(/^\s*[-*•\d.]+\s*/, '').trim())
        .filter(Boolean);
    }

    if (suggestions.length > count) suggestions = suggestions.slice(0, count);

    return {
      suggestions,
      model,
      tokensUsed: tokensUsed ?? 0,
    };
  },

  /**
   * Tổng hợp tin nhắn nhóm theo hội thoại và tóm tắt recap session unread gần nhất.
   * Phần chưa đọc không suy ngược từ lastReadAt hiện tại nữa; nó dùng snapshot đã chụp
   * ngay trước lúc group bị mark-read.
   */
  summarizeGroupMessages: async (
    request: IAiGroupSummaryRequest & { userId: string },
  ): Promise<IAiGroupSummaryResponse> => {
    const limit = Math.min(Math.max(5, request.limit ?? 30), 80);

    const conv = await conversationRepository.getConversationById(request.conversationId);
    if (!conv) {
      throw new Error('Conversation not found');
    }
    if (conv.type !== 'group') {
      throw new Error('Conversation is not a group');
    }

    const member = await conversationRepository.getMember(request.conversationId, request.userId);
    if (!member) {
      throw new ForbiddenError('Bạn không phải là thành viên của hội thoại này');
    }

    const minCreatedAtMs = resolveMessageHistoryMinCreatedAtMs(conv, member);
    const fetchLimit = Math.min(Math.max(limit * 4, limit), 400);
    const [hiddenMessageIds, recent, initialRecapSession] = await Promise.all([
      messageUserHideRepository.queryHiddenMessageIdsForConversation(
        request.userId,
        request.conversationId,
      ),
      conversationRepository.listRecentMessages(request.conversationId, {
        limit: fetchLimit,
        minCreatedAtMs,
      }),
      groupRecapSessionService.getUsableCurrentSession(request.conversationId, request.userId),
    ]);
    const recapSession =
      (member.unreadCount ?? 0) > 0 && recent[0]
        ? await groupRecapSessionService.captureBeforeMarkRead({
            conversation: conv,
            member,
            userId: request.userId,
            conversationId: request.conversationId,
            toMessage: recent[0],
          })
        : initialRecapSession;

    const visibleRecent = filterMessagesByJoinHistoryCutoff(
      recent.filter((m) => !isMessageHiddenFromViewer(m, hiddenMessageIds)),
      minCreatedAtMs,
    );
    const summarizableRecentNewestFirst = visibleRecent.filter(isSummarizableGroupMessage);
    const kept = await attachSenderDisplayNames(
      summarizableRecentNewestFirst.slice(0, limit).reverse(),
    ); // oldest -> newest

    const recapSessionMessages =
      recapSession && recapSession.capturedMessageCount > 0
        ? await attachSenderDisplayNames(
            filterMessagesByJoinHistoryCutoff(
              (
                await conversationRepository.listMessagesInSortKeyRange(request.conversationId, {
                  fromSortKey: recapSession.fromSortKey,
                  toSortKey: recapSession.toSortKey,
                  limit: Math.min(Math.max(recapSession.capturedMessageCount * 4, limit), 500),
                })
              ).filter((m) => !isMessageHiddenFromViewer(m, hiddenMessageIds)),
              minCreatedAtMs,
            )
              .filter((m) => m.senderId !== request.userId)
              .filter(isSummarizableGroupMessage),
          )
        : [];
    const unreadMessageCount = recapSession?.capturedMessageCount ?? 0;
    const cachedUnreadSummary =
      recapSession?.status === 'COMPLETED' ? (recapSession.unreadSummary?.trim() ?? '') : '';
    const completedSummaryLooksWrong =
      recapSession?.status === 'COMPLETED' &&
      recapSessionMessages.length > 0 &&
      EMPTY_UNREAD_SUMMARY_SENTINELS.has(cachedUnreadSummary);
    const shouldGenerateUnreadSummary =
      recapSession?.status === 'PENDING' || completedSummaryLooksWrong;
    const unreadSummaryFromSession =
      recapSession?.status === 'COMPLETED' && !completedSummaryLooksWrong
        ? cachedUnreadSummary
        : '';
    const unreadMessages = shouldGenerateUnreadSummary ? recapSessionMessages : [];

    if (kept.length === 0) {
      const fallbackUnreadSummary =
        unreadSummaryFromSession ||
        (unreadMessageCount > 0
          ? 'Có tin nhắn chưa đọc nhưng chưa có đủ nội dung văn bản để tóm tắt.'
          : 'Không có tin nhắn chưa đọc');
      return {
        summary: 'Chưa có đủ tin nhắn để tổng hợp.',
        highlights: [],
        unreadSummary: fallbackUnreadSummary,
        unreadMessageCount,
        model: aiConfig.modelId,
        tokensUsed: 0,
      };
    }

    const transcript = renderGroupTranscript(kept);
    const unreadTranscript =
      unreadMessages.length > 0
        ? renderGroupTranscript(unreadMessages)
        : '(không có tin nhắn chưa đọc phù hợp để tóm tắt)';

    // if (shouldGenerateUnreadSummary) {
    //   await writeAiUnreadSummaryTranscriptLog({
    //     conversationId: request.conversationId,
    //     userId: request.userId,
    //     recapSessionId: recapSession?.recapSessionId,
    //     recapSessionStatus: recapSession?.status,
    //     unreadMessageCount,
    //     messagesSentToAi: unreadMessages.length,
    //     unreadTranscript,
    //   });
    // }

    const promptLines = [
      `Bạn là trợ lý tổng hợp tin nhắn nhóm.`,
      `Hãy đọc các transcript theo thứ tự thời gian và tạo:`,
      `1) summary: 3-6 bullet ngắn, nêu đúng ý chính của phần tổng hợp tin nhắn.`,
      `2) highlights: 0-6 bullet về quyết định / việc cần làm / câu hỏi còn bỏ ngỏ.`,
      ...(shouldGenerateUnreadSummary
        ? [`3) unreadSummary: 2-5 bullet ngắn, chỉ dựa trên phần tin nhắn chưa đọc.`]
        : []),
      `Yêu cầu: không bịa thêm thông tin; chỉ dựa trên transcript.`,
      ``,
      `Transcript tổng hợp tin nhắn:`,
      transcript,
    ];
    if (shouldGenerateUnreadSummary) {
      promptLines.push(
        ``,
        `Chỉ khi transcript tin nhắn chưa đọc bên dưới đúng bằng "(không có tin nhắn chưa đọc phù hợp để tóm tắt)" thì unreadSummary mới được là "Không có tin nhắn chưa đọc phù hợp để tóm tắt.".`,
        `Nếu transcript tin nhắn chưa đọc có ít nhất một dòng hội thoại, unreadSummary bắt buộc phải tóm tắt các dòng đó và không được nói là không có tin nhắn chưa đọc.`,
        ``,
        `Transcript tin nhắn chưa đọc:`,
        unreadTranscript,
        ``,
        `Trả về đúng JSON theo schema: {"summary": string, "highlights": string[], "unreadSummary": string}`,
      );
    } else {
      promptLines.push(
        ``,
        `Trả về đúng JSON theo schema: {"summary": string, "highlights": string[]}`,
      );
    }
    const prompt = promptLines.join('\n');

    const { text, model, tokensUsed } = await generateText(prompt, {
      systemPrompt: shouldGenerateUnreadSummary
        ? 'Bạn là trợ lý tổng hợp hội thoại nhóm. Không bịa thêm thông tin. Chỉ trả JSON hợp lệ theo schema {"summary": string, "highlights": string[], "unreadSummary": string}.'
        : 'Bạn là trợ lý tổng hợp hội thoại nhóm. Không bịa thêm thông tin. Chỉ trả JSON hợp lệ theo schema {"summary": string, "highlights": string[]}.',
    });

    let summary = '';
    let highlights: string[] = [];
    let unreadSummary = '';
    let totalTokensUsed = tokensUsed ?? 0;
    try {
      const parsed = JSON.parse(text) as {
        summary?: unknown;
        highlights?: unknown;
        unreadSummary?: unknown;
      };
      summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
      if (Array.isArray(parsed.highlights)) {
        highlights = parsed.highlights.map((s) => String(s).trim()).filter(Boolean);
      }
      unreadSummary = typeof parsed.unreadSummary === 'string' ? parsed.unreadSummary.trim() : '';
    } catch {
      summary = text.trim();
      highlights = [];
    }

    if (
      shouldGenerateUnreadSummary &&
      isInvalidUnreadSummaryForTranscript(unreadSummary, unreadMessages)
    ) {
      const retry = await generateUnreadSummaryFromTranscript(unreadTranscript);
      unreadSummary = retry.text.trim();
      totalTokensUsed += retry.tokensUsed ?? 0;
    }

    const hasInvalidUnreadSummaryAfterRetry =
      shouldGenerateUnreadSummary &&
      isInvalidUnreadSummaryForTranscript(unreadSummary, unreadMessages);
    const finalUnreadSummary =
      unreadSummaryFromSession ||
      (unreadMessages.length > 0
        ? hasInvalidUnreadSummaryAfterRetry
          ? 'Có tin nhắn chưa đọc phù hợp nhưng chưa tạo được tóm tắt.'
          : unreadSummary || 'Chưa tạo được tóm tắt tin nhắn chưa đọc.'
        : unreadMessageCount > 0
          ? 'Có tin nhắn chưa đọc nhưng chưa có đủ nội dung văn bản để tóm tắt.'
          : 'Không có tin nhắn chưa đọc');

    if (
      shouldGenerateUnreadSummary &&
      recapSession &&
      unreadMessages.length > 0 &&
      !hasInvalidUnreadSummaryAfterRetry
    ) {
      await groupRecapSessionService.saveUnreadSummary(
        request.conversationId,
        request.userId,
        recapSession.recapSessionId,
        finalUnreadSummary,
      );
    }

    return {
      summary: summary || 'Chưa tạo được phần tổng hợp.',
      highlights: highlights.slice(0, 6),
      unreadSummary: finalUnreadSummary,
      unreadMessageCount,
      model,
      tokensUsed: totalTokensUsed,
    };
  },

  chatbot: async (_request: IAiChatbotRequest): Promise<IAiChatbotResponse> => {
    // TODO: implement using generateText()
    throw new Error('Chưa triển khai');
  },

  analyzeSentiment: async (_text: string): Promise<IAiSentimentResult> => {
    // TODO: implement using generateText()
    throw new Error('Chưa triển khai');
  },

  generatePost: async (_request: IAiGeneratePostRequest): Promise<IAiGeneratePostResponse> => {
    // TODO: implement using generateText()
    throw new Error('Chưa triển khai');
  },

  aiAssistant: async (request: IAiAssistantRequest): Promise<IAiAssistantResponse> => {
    return runAiAssistantPipeline(request);
  },
};
