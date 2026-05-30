import {
  inferCommunitySearchArgs,
  shouldOverrideCommunitySearchQuery,
} from '../../assistant/tools/community-search-args.js';

describe('inferCommunitySearchArgs', () => {
  it('gợi ý 1 cộng đồng → query *', () => {
    expect(inferCommunitySearchArgs('Gợi ý 1 cộng đồng cho tôi')).toEqual({ query: '*' });
  });

  it('gợi ý cộng đồng công nghệ → * + technology', () => {
    expect(inferCommunitySearchArgs('Gợi ý cộng đồng về công nghệ')).toEqual({
      query: '*',
      category: 'technology',
    });
  });

  it('tìm cộng đồng về Hamtech → query Hamtech', () => {
    expect(inferCommunitySearchArgs('Bạn hãy tìm cộng đồng về Hamtech!')).toEqual({
      query: 'Hamtech',
    });
  });
});

describe('shouldOverrideCommunitySearchQuery', () => {
  it('bịa Tech Enthusiasts khi user không nhắc', () => {
    expect(
      shouldOverrideCommunitySearchQuery('Gợi ý 1 cộng đồng cho tôi', 'Tech Enthusiasts'),
    ).toBe(true);
  });

  it('giữ query user đã nêu', () => {
    expect(
      shouldOverrideCommunitySearchQuery('Tìm cộng đồng Lập trình viên', 'Lập trình viên'),
    ).toBe(false);
  });
});
