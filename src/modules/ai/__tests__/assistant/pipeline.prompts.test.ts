import {
  buildAssistantRuntimeContext,
  buildAssistantSystemPrompt,
} from '../../assistant/pipeline/pipeline.prompts.js';

describe('pipeline.prompts', () => {
  it('runtime context có múi giờ VN', () => {
    const ctx = buildAssistantRuntimeContext('vi');
    expect(ctx).toContain('Asia/Ho_Chi_Minh');
    expect(ctx.length).toBeGreaterThan(20);
  });

  it('system prompt cho phép câu hỏi chung và chặn nội dung đồi trụy', () => {
    const prompt = buildAssistantSystemPrompt({
      locale: 'vi',
      toolDoc: '- search_messages: {}',
    });
    expect(prompt).toContain('câu hỏi chung');
    expect(prompt).toContain('đồi trụy');
    expect(prompt).toMatch(/thời gian|giờ/i);
    expect(prompt).toContain('Asia/Ho_Chi_Minh');
  });
});
