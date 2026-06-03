import type {
  IAiGroupSummaryRequest,
  IAiGroupSummaryResponse,
} from '../shared/types/content.types.js';
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
import { generateText } from '../shared/llm/generate-text.js';
import type { AiGenerateTextResult } from '../shared/llm/generate-text.js';

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

const stripAiDecorations = (text: string): string =>
  text
    .trim()
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*[•●◦▪▫*-]\s*/, '')
        .replace(/^\s*```(?:json)?\s*$/i, '```')
        .trimEnd(),
    )
    .join('\n')
    .trim();

const extractJsonObjectText = (text: string): string | null => {
  const cleaned = stripAiDecorations(text);
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = stripAiDecorations(fenced?.[1] ?? cleaned);
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return candidate.slice(start, end + 1);
};

const normalizeAiTextList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value !== 'string') return [];
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[•●◦▪▫*-]\s*/, '').trim())
    .filter(Boolean);
};

const normalizeAiTextBlock = (value: unknown): string => {
  if (Array.isArray(value)) {
    return normalizeAiTextList(value)
      .map((item) => `- ${item}`)
      .join('\n');
  }
  if (typeof value !== 'string') return '';
  return stripAiDecorations(value)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
};

const parseGroupSummaryAiOutput = (
  text: string,
): { summary: string; highlights: string[]; unreadSummary: string } => {
  const jsonText = extractJsonObjectText(text);
  if (!jsonText) {
    return {
      summary: normalizeAiTextBlock(text),
      highlights: [],
      unreadSummary: '',
    };
  }

  try {
    const parsed = JSON.parse(jsonText) as {
      summary?: unknown;
      highlights?: unknown;
      unreadSummary?: unknown;
    };
    return {
      summary: normalizeAiTextBlock(parsed.summary),
      highlights: normalizeAiTextList(parsed.highlights),
      unreadSummary: normalizeAiTextBlock(parsed.unreadSummary),
    };
  } catch {
    return {
      summary: normalizeAiTextBlock(text),
      highlights: [],
      unreadSummary: '',
    };
  }
};

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

export const groupSummaryService = {
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
    );

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

    const promptLines = [
      `Bạn là trợ lý tổng hợp tin nhắn nhóm.`,
      `Hãy đọc các transcript theo thứ tự thời gian và tạo:`,
      `1) summary: 3-6 bullet ngắn, nêu đúng ý chính của phần tổng hợp tin nhắn.`,
      `2) highlights: 0-6 bullet về quyết định / việc cần làm / câu hỏi còn bỏ ngỏ.`,
      ...(shouldGenerateUnreadSummary
        ? [`3) unreadSummary: 2-5 bullet ngắn, chỉ dựa trên phần tin nhắn chưa đọc.`]
        : []),
      `Yêu cầu: không bịa thêm thông tin; chỉ dựa trên transcript.`,
      `Output bắt buộc là JSON thô, không bọc markdown, không dùng \`\`\`json, không thêm bullet/ký tự trước JSON.`,
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
        `Trả về đúng JSON thô theo schema: {"summary": string, "highlights": string[], "unreadSummary": string}`,
      );
    } else {
      promptLines.push(
        ``,
        `Trả về đúng JSON thô theo schema: {"summary": string, "highlights": string[]}`,
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
    const parsedOutput = parseGroupSummaryAiOutput(text);
    summary = parsedOutput.summary;
    highlights = parsedOutput.highlights;
    unreadSummary = parsedOutput.unreadSummary;

    if (
      shouldGenerateUnreadSummary &&
      isInvalidUnreadSummaryForTranscript(unreadSummary, unreadMessages)
    ) {
      const retry = await generateUnreadSummaryFromTranscript(unreadTranscript);
      unreadSummary = normalizeAiTextBlock(retry.text);
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
};
