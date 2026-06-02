import { aiService } from '../ai.service.js';
import { generateText } from '../shared/llm/generate-text.js';

jest.mock('../shared/llm/generate-text.js', () => ({
  generateText: jest.fn(),
}));

describe('AI Service - Text Paraphrase and Suggestions Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('TC01 (Pass): suggestContent should return a list of parsed suggestions', async () => {
    (generateText as jest.Mock).mockResolvedValue({
      text: JSON.stringify({
        suggestions: ['Chào bạn nha', 'Hello cậu', 'Chào nha', 'Hi cậu', 'Xin chào'],
      }),
      model: 'amazon.nova-pro-v1:0',
      tokensUsed: 120,
    });

    const result = await aiService.suggestContent({
      context: 'Xin chào',
      type: 'reply',
      language: 'vi',
      topics: [],
    });

    expect(result.suggestions).toHaveLength(5);
    expect(result.suggestions[0]).toBe('Chào bạn nha');
    expect(result.model).toBe('amazon.nova-pro-v1:0');
  });

  it('TC02 (Pass): suggestContent should parse line-by-line fallback if JSON fails', async () => {
    (generateText as jest.Mock).mockResolvedValue({
      text: '- Suggestion A\n- Suggestion B',
      model: 'amazon.nova-pro-v1:0',
      tokensUsed: 80,
    });

    const result = await aiService.suggestContent({
      context: 'Paraphrase text',
      type: 'post',
      language: 'en',
      topics: [],
    });

    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions[0]).toBe('Suggestion A');
  });

  it('TC04 (Pass): suggestContent should parse fenced JSON with bullet decoration', async () => {
    (generateText as jest.Mock).mockResolvedValue({
      text: [
        '• ```json',
        '• {',
        '• "suggestions": ["Chào bạn nha", "Bạn khỏe không?", "Đi ăn cơm chưa?"]',
        '• }',
        '• ```',
      ].join('\n'),
      model: 'gemini-2.0-flash',
      tokensUsed: 90,
    });

    const result = await aiService.suggestContent({
      context: 'Chào bạn',
      type: 'reply',
      language: 'vi',
      topics: [],
    });

    expect(result.suggestions).toEqual(['Chào bạn nha', 'Bạn khỏe không?', 'Đi ăn cơm chưa?']);
  });

  it('TC03 (Pass): suggestContent should propagate generateText errors correctly', async () => {
    (generateText as jest.Mock).mockRejectedValue(new Error('AWS Bedrock Client Timeout'));

    await expect(
      aiService.suggestContent({
        context: 'Hello',
        type: 'caption',
        language: 'vi',
        topics: [],
      }),
    ).rejects.toThrow('AWS Bedrock Client Timeout');
  });
});
