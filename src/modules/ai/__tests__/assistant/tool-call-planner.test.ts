import { planAiToolCalls } from '../../assistant/tools/tool-call-planner.js';

describe('planAiToolCalls', () => {
  it('adds search_communities when community suggestion intent requires it', () => {
    expect(planAiToolCalls('Gợi ý 1 cộng đồng cho tôi', [])).toEqual([
      { name: 'search_communities', args: { query: '*' } },
    ]);
  });

  it('normalizes invented community query from model', () => {
    expect(
      planAiToolCalls('Gợi ý cộng đồng về công nghệ', [
        { name: 'search_communities', args: { query: 'Tech Enthusiasts' } },
      ]),
    ).toEqual([{ name: 'search_communities', args: { query: '*', category: 'technology' } }]);
  });

  it('adds search_messages when message search intent requires it', () => {
    expect(planAiToolCalls('Tìm tin nhắn về dự án X', [])).toEqual([
      { name: 'search_messages', args: { query: 'Tìm tin nhắn về dự án X' } },
    ]);
  });
});
