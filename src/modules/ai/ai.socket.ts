import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { logger } from '@/shared/utils/logger.js';
import { runAiAssistantPipeline, type AiAssistantStage } from './ai-assistant.pipeline.js';
import { aiAssistantRepository } from './ai-assistant.repository.js';

const threadJoinSchema = z.object({
  threadId: z.string().uuid().optional(),
});

const messageSendSchema = z.object({
  threadId: z.string().uuid().optional(),
  message: z.string().min(1).max(10000),
  locale: z.enum(['vi', 'en']).optional(),
});

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
      const parsed = threadJoinSchema.safeParse(data ?? {});
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
    try {
      const parsed = messageSendSchema.safeParse(data ?? {});
      if (!parsed.success) {
        socket.emit('ai:error', { error: 'Dữ liệu không hợp lệ', details: parsed.error.flatten() });
        return;
      }
      const { threadId: bodyThreadId, message, locale } = parsed.data;

      const threadId =
        bodyThreadId ?? (await aiAssistantRepository.getOrCreateDefaultThreadId(userId));
      await aiAssistantRepository.assertThreadOwnedByUser(userId, threadId);

      socket.join(`aiThread:${threadId}`);

      const result = await runAiAssistantPipeline(
        {
          userId,
          message,
          threadId,
          locale,
        },
        (stage, detail) => {
          io.to(`user:${userId}`).emit('ai:status', {
            threadId,
            stage,
            label: stageLabelByKey[stage] ?? stage,
            ...(detail ? { detail } : {}),
          });
        },
      );

      const payload = {
        threadId: result.threadId,
        reply: result.reply,
        model: result.model,
        tokensUsed: result.tokensUsed,
        actions: result.actions ?? [],
        userMessageId: result.userMessageId,
        assistantMessageId: result.assistantMessageId,
      };
      io.to(`user:${userId}`).emit('ai:message_done', payload);
    } catch (e) {
      logger.error('ai:message_send', e);
      socket.emit('ai:error', { error: e instanceof Error ? e.message : 'Gửi tin AI thất bại' });
    }
  });
}
