import {
  AI_ASSISTANT_TOOLS,
  buildToolDoc,
  EXECUTOR_TOOL_NAMES,
  getActivePolicyHints,
  KNOWN_TOOL_NAMES,
} from '../../assistant/tools/tool-registry.js';

describe('tool-registry', () => {
  it('mọi executor tool có trong KNOWN_TOOL_NAMES', () => {
    for (const name of EXECUTOR_TOOL_NAMES) {
      expect(KNOWN_TOOL_NAMES.has(name)).toBe(true);
    }
  });

  it('buildToolDoc vi có search_communities', () => {
    const doc = buildToolDoc('vi');
    expect(doc).toContain('search_communities');
    expect(doc).toContain('search_messages');
  });

  it('policy force_message_search', () => {
    const hints = getActivePolicyHints('tìm tin nhắn về dự án', 'vi');
    expect(hints.some((h) => h.includes('search_messages'))).toBe(true);
  });

  it('policy force_community_suggest', () => {
    const hints = getActivePolicyHints('gợi ý cộng đồng về công nghệ', 'vi');
    expect(hints.some((h) => h.includes('search_communities'))).toBe(true);
  });

  it('AI_ASSISTANT_TOOLS không trùng tên', () => {
    const names = AI_ASSISTANT_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
