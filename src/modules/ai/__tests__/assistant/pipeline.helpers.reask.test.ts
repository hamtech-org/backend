import {
  filterRagHitsForTurn,
  isNearDuplicateQuestion,
  prepareHistoryForTurn,
} from '../../assistant/pipeline/pipeline.helpers.js';

describe('re-ask handling', () => {
  it('nhận diện câu hỏi trùng', () => {
    expect(isNearDuplicateQuestion('Bây giờ mấy giờ?', 'bay gio may gio')).toBe(true);
    expect(isNearDuplicateQuestion('hello', 'world')).toBe(false);
  });

  it('loại cặp Q&A cũ khi hỏi lại', () => {
    const { transcript, isReAsk } = prepareHistoryForTurn(
      [
        { messageId: 'u1', role: 'user', content: 'Mấy giờ rồi?' },
        { messageId: 'a1', role: 'assistant', content: '9 giờ sáng.' },
        { messageId: 'u2', role: 'user', content: 'Mấy giờ rồi?' },
      ],
      { excludeMessageId: 'u2', currentMessage: 'Mấy giờ rồi?', maxLines: 32 },
    );
    expect(isReAsk).toBe(true);
    expect(transcript).not.toContain('9 giờ sáng');
  });

  it('RAG hỏi lại bỏ chunk assistant cũ', () => {
    const hits = filterRagHitsForTurn(
      [
        { role: 'user', text: 'Mấy giờ rồi?' },
        { role: 'assistant', text: '9 giờ sáng.' },
      ],
      'Mấy giờ rồi?',
      true,
    );
    expect(hits).toHaveLength(0);
  });
});
