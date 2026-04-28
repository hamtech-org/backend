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
} from './ai.types.js';
import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { aiConfig, bedrockRuntimeClient, type BedrockAiConfig } from '@/config/ai.js';
import { conversationRepository } from '@/modules/chat/conversation/conversation.repository.js';
import type { IMessage } from '@/modules/chat/shared/chat.types.js';

export type AiGenerateTextOptions = Partial<
  Pick<BedrockAiConfig, 'modelId' | 'maxTokens' | 'temperature' | 'topP'>
> & {
  systemPrompt?: string;
};

export type AiGenerateTextResult = {
  text: string;
  model: string;
  tokensUsed?: number;
};

export async function generateText(
  prompt: string,
  options: AiGenerateTextOptions = {},
): Promise<AiGenerateTextResult> {
  const input = prompt?.trim();
  if (!input) {
    return { text: '', model: options.modelId ?? aiConfig.modelId, tokensUsed: 0 };
  }

  const modelId = options.modelId ?? aiConfig.modelId;
  const maxTokens = options.maxTokens ?? aiConfig.maxTokens;
  const temperature = options.temperature ?? aiConfig.temperature;
  const topP = options.topP ?? aiConfig.topP;

  const res = await bedrockRuntimeClient.send(
    new ConverseCommand({
      modelId,
      ...(options.systemPrompt
        ? {
            system: [
              {
                text: options.systemPrompt,
              },
            ],
          }
        : {}),
      messages: [
        {
          role: 'user',
          content: [{ text: input }],
        },
      ],
      inferenceConfig: {
        maxTokens,
        temperature,
        topP,
      },
    }),
  );

  const text =
    res.output?.message?.content
      ?.map((c) => ('text' in c ? c.text : ''))
      .filter(Boolean)
      .join('')
      .trim() ?? '';

  const tokensUsed = res.usage?.totalTokens;

  return {
    text,
    model: modelId,
    ...(typeof tokensUsed === 'number' ? { tokensUsed } : {}),
  };
}

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
};
