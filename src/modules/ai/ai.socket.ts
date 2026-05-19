import type { Server, Socket } from 'socket.io';
import { logger } from '@/shared/utils/logger.js';
import {
  isAiAssistantCancellation,
  runAiAssistantPipeline,
  type AiAssistantStage,
} from './ai-assistant.pipeline.js';
import { aiAssistantRepository } from './ai-assistant.repository.js';
import {
  aiAssistantMessageCancelSchema,
  aiAssistantMessageSendSchema,
  aiAssistantThreadJoinSchema,
} from './ai-assistant.schema.js';

const activeAiRequests = new Map<string, AbortController>();
const cancelledAiRequests = new Set<string>();

function activeRequestKey(userId: string, requestId: string): string {
  return `${userId}:${requestId}`;
}

export function registerAiAssistantHandlers(io: Server, socket: Socket): void {
  const userId = socket.data.userId as string;
  const stageLabelByKey: Record<AiAssistantStage, string> = {
    init: 'Khởi tạo yêu cầu',
    persist_user_message: 'Đang lưu tin nhắn của bạn',
    await_user_confirmation: 'Đang chờ bạn xác nhận thao tác',
    embedding_query: 'Đang phận tích câu hỏi',
    rag_search: 'Đang suy nghĩ',
    load_history: 'Tìm kiếm lịch sử',
    model_reasoning: 'Đang phân tích và lập kế hoạch trả lời',
    tool_execution: 'Đang tìm kiếm công cụ',
    model_finalize: 'Tổng hợp kết quả',
    persist_assistant_message: 'Lưu trữ phản hồi',
    embedding_reply: 'Cập nhật lưu trữ',
    completed: 'Hoàn tất',
  };

  socket.on('ai:thread_join', async (data: unknown) => {
    try {
      const parsed = aiAssistantThreadJoinSchema.safeParse(data ?? {});
      if (!parsed.success) {
        socket.emit('ai:error', { error: 'Dữ liệu không hợp lệ', details: parsed.error.flatten() });
        return;
      }
      let threadId = parsed.data.threadId;
      if (!threadId) {
        threadId = await aiAssistantRepository.getOrCreateDefaultThreadId(userId);
      } else {
        await aiAssistantRepository.assertThreadOwnedByUser(userId, threadId);
      }
      socket.join(`aiThread:${threadId}`);
      socket.emit('ai:thread_ready', { threadId });
    } catch (e) {
      logger.error('ai:thread_join', e);
      socket.emit('ai:error', { error: e instanceof Error ? e.message : 'Lỗi' });
    }
  });

  socket.on('ai:message_send', async (data: unknown) => {
    let activeKey = '';
    try {
      const parsed = aiAssistantMessageSendSchema.safeParse(data ?? {});
      if (!parsed.success) {
        socket.emit('ai:error', { error: 'Dữ liệu không hợp lệ', details: parsed.error.flatten() });
        return;
      }
      const { threadId: bodyThreadId, message, locale, requestId } = parsed.data;

      const threadId =
        bodyThreadId ?? (await aiAssistantRepository.getOrCreateDefaultThreadId(userId));
      await aiAssistantRepository.assertThreadOwnedByUser(userId, threadId);

      socket.join(`aiThread:${threadId}`);
      const controller = new AbortController();
      if (requestId) {
        activeKey = activeRequestKey(userId, requestId);
        activeAiRequests.get(activeKey)?.abort();
        activeAiRequests.set(activeKey, controller);
        if (cancelledAiRequests.delete(activeKey)) {
          controller.abort();
        }
      }

      const result = await runAiAssistantPipeline(
        {
          userId,
          message,
          threadId,
          locale,
        },
        {
          signal: controller.signal,
          onStage: (stage, detail) => {
            io.to(`user:${userId}`).emit('ai:status', {
              threadId,
              requestId,
              stage,
              label: stageLabelByKey[stage] ?? stage,
              ...(detail ? { detail } : {}),
            });
          },
        },
      );

      const payload = {
        threadId: result.threadId,
        requestId,
        reply: result.reply,
        model: result.model,
        tokensUsed: result.tokensUsed,
        actions: result.actions ?? [],
        userMessageId: result.userMessageId,
        assistantMessageId: result.assistantMessageId,
      };
      io.to(`user:${userId}`).emit('ai:message_done', payload);
    } catch (e) {
      if (isAiAssistantCancellation(e)) {
        const parsed = aiAssistantMessageSendSchema.safeParse(data ?? {});
        io.to(`user:${userId}`).emit('ai:message_cancelled', {
          requestId: parsed.success ? parsed.data.requestId : undefined,
          threadId: parsed.success ? parsed.data.threadId : undefined,
        });
        return;
      }
      logger.error('ai:message_send', e);
      socket.emit('ai:error', { error: e instanceof Error ? e.message : 'Gửi tin AI thất bại' });
    } finally {
      if (activeKey) {
        activeAiRequests.delete(activeKey);
        cancelledAiRequests.delete(activeKey);
      }
    }
  });

  socket.on('ai:message_cancel', async (data: unknown) => {
    try {
      const parsed = aiAssistantMessageCancelSchema.safeParse(data ?? {});
      if (!parsed.success) {
        socket.emit('ai:error', { error: 'Dữ liệu không hợp lệ', details: parsed.error.flatten() });
        return;
      }
      if (parsed.data.threadId) {
        await aiAssistantRepository.assertThreadOwnedByUser(userId, parsed.data.threadId);
      }
      const key = activeRequestKey(userId, parsed.data.requestId);
      const controller = activeAiRequests.get(key);
      if (controller) {
        controller.abort();
      } else {
        cancelledAiRequests.add(key);
        setTimeout(() => cancelledAiRequests.delete(key), 60_000).unref?.();
      }
      socket.emit('ai:message_cancelled', {
        requestId: parsed.data.requestId,
        threadId: parsed.data.threadId,
      });
    } catch (e) {
      logger.error('ai:message_cancel', e);
      socket.emit('ai:error', { error: e instanceof Error ? e.message : 'Dừng AI thất bại' });
    }
  });
}
