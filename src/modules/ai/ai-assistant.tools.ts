import { searchService } from '@/modules/search/search.service.js';
import type { AiAssistantClientAction } from './ai.types.js';
import { generateText } from './ai-generate-text.js';
import { env } from '@/config/env.js';

export type AiToolCall = {
  name: string;
  args: Record<string, unknown>;
};

export type AiToolExecutionResult = {
  textForModel: string;
  clientActions: AiAssistantClientAction[];
};

type AiToolExecutionOptions = {
  signal?: AbortSignal;
};

const MAX_QUERY_LEN = 200;
const MAX_MESSAGE_RESULT_CONTENT_LEN = 600;

function safeQuery(q: unknown): string {
  const s = typeof q === 'string' ? q : String(q ?? '');
  return s.trim().slice(0, MAX_QUERY_LEN);
}

function truncateForTool(text: string, maxLen: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

export async function executeAiToolCalls(
  userId: string,
  calls: AiToolCall[],
  options: AiToolExecutionOptions = {},
): Promise<AiToolExecutionResult> {
  const parts: string[] = [];
  const clientActions: AiAssistantClientAction[] = [];

  for (const c of calls.slice(0, 5)) {
    if (options.signal?.aborted) {
      throw new DOMException('AI request was cancelled', 'AbortError');
    }
    const name = String(c.name ?? '').trim();
    const args = c.args ?? {};

    try {
      if (name === 'search_messages') {
        const q = safeQuery(args.query);
        const r = await searchService.searchMessages(userId, {
          query: q || '*',
          page: 1,
          pageSize: 8,
        });
        if (r.items.length > 0) {
          clientActions.push({
            type: 'show_message_results',
            payload: {
              source: 'search_messages',
              query: q,
              messages: r.items.slice(0, 8).map((item, index) => ({
                ...item,
                resultKey: `R${index + 1}`,
              })),
            },
          });
        }
        const modelItems = r.items.slice(0, 8).map((item, index) => ({
          resultKey: `R${index + 1}`,
          sender: item.senderDisplayName?.trim() || 'Thành viên',
          conversation: item.conversationName?.trim() || 'Hội thoại',
          content: truncateForTool(item.content, MAX_MESSAGE_RESULT_CONTENT_LEN),
          createdAt: item.createdAt,
        }));
        parts.push(
          [
            `[search_messages query="${q}"]`,
            'Dữ liệu đã thay senderId/messageId thật bằng resultKey tạm. Khi trả lời user, chỉ dùng tên người gửi/conversation; tuyệt đối không nhắc UUID/id.',
            'Nếu kết quả nào thật sự liên quan, chọn resultKey vào messageResultKeys.',
            JSON.stringify(modelItems, null, 2).slice(0, 5000),
          ].join('\n'),
        );
        continue;
      }

      if (name === 'search_users') {
        const q = safeQuery(args.query);
        const r = await searchService.searchUsers({
          query: q || '*',
          page: 1,
          pageSize: 8,
          userId,
        });
        if (r.items.length > 0) {
          clientActions.push({
            type: 'show_user_cards',
            payload: { source: 'search_users', query: q, users: r.items.slice(0, 8) },
          });
        }
        parts.push(
          `[search_users query="${q}"]\n${JSON.stringify(r.items, null, 2).slice(0, 4000)}`,
        );
        continue;
      }

      if (name === 'search_users_contacts') {
        const q = safeQuery(args.query);
        const r = await searchService.searchUsersByContact({
          query: q || '*',
          page: 1,
          pageSize: 8,
          userId,
        });
        if (r.items.length > 0) {
          clientActions.push({
            type: 'show_user_cards',
            payload: { source: 'search_users_contacts', query: q, users: r.items.slice(0, 8) },
          });
        }
        parts.push(
          `[search_users_contacts query="${q}"]\n${JSON.stringify(r.items, null, 2).slice(0, 4000)}`,
        );
        continue;
      }

      if (name === 'search_groups') {
        const q = safeQuery(args.query);
        const r = await searchService.searchGroups({
          query: q || '*',
          page: 1,
          pageSize: 8,
          userId,
        });
        if (r.items.length > 0) {
          clientActions.push({
            type: 'show_group_results',
            payload: { source: 'search_groups', query: q, groups: r.items.slice(0, 8) },
          });
        }
        parts.push(
          `[search_groups query="${q}"]\n${JSON.stringify(r.items, null, 2).slice(0, 4000)}`,
        );
        continue;
      }

      if (name === 'suggest_create_poll') {
        const conversationId =
          typeof args.conversationId === 'string' ? args.conversationId.trim() : undefined;
        const question = typeof args.question === 'string' ? args.question.trim() : undefined;
        const options = Array.isArray(args.options)
          ? args.options
              .map((x) => String(x).trim())
              .filter(Boolean)
              .slice(0, 10)
          : undefined;
        clientActions.push({
          type: 'open_create_poll',
          payload: { conversationId, question, options },
        });
        parts.push(
          `[suggest_create_poll] Đã chuẩn bị thao tác mở form tạo bình chọn trên client (conversationId=${conversationId ?? 'null'}).`,
        );
        continue;
      }

      if (name === 'invoke_secondary_model') {
        const prompt = safeQuery(args.prompt) || safeQuery(args.message);
        const modelId =
          typeof args.modelId === 'string' && args.modelId.trim()
            ? args.modelId.trim()
            : env.BEDROCK_SECONDARY_MODEL_ID?.trim();
        if (!modelId) {
          parts.push('[invoke_secondary_model] Không cấu hình BEDROCK_SECONDARY_MODEL_ID.');
          continue;
        }
        const { text } = await generateText(prompt, {
          modelId,
          maxTokens: 512,
          signal: options.signal,
        });
        parts.push(`[invoke_secondary_model model=${modelId}]\n${text.slice(0, 8000)}`);
        continue;
      }

      parts.push(`[unknown_tool name=${name}]`);
    } catch (e) {
      if (options.signal?.aborted) {
        throw e;
      }
      const message = e instanceof Error ? e.message : String(e);
      parts.push(`[tool_error name=${name}] ${message}`);
    }
  }

  return {
    textForModel: parts.join('\n\n'),
    clientActions,
  };
}
