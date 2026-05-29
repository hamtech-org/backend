import { executeAiToolCalls } from '../../assistant/tools/execute-tools.js';
import { searchService } from '@/modules/search/search.service.js';

jest.mock('@/modules/search/search.service.js', () => ({
  searchService: {
    searchCommunities: jest.fn(),
  },
}));

const searchCommunitiesMock = searchService.searchCommunities as jest.Mock;

describe('executeAiToolCalls search_communities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('gọi searchCommunities và trả textForModel có resultKey', async () => {
    searchCommunitiesMock.mockResolvedValue({
      items: [
        {
          groupId: 'g1',
          communityId: 'g1',
          name: 'Cộng đồng A',
          description: 'Mô tả',
          category: 'technology',
          memberCount: 12,
          type: 'public',
          slug: 'cong-dong-a',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 8,
      hasMore: false,
    });

    const { textForModel, clientActions } = await executeAiToolCalls('user-1', [
      { name: 'search_communities', args: { query: 'công nghệ', category: 'technology' } },
    ]);

    expect(searchCommunitiesMock).toHaveBeenCalledWith({
      query: 'công nghệ',
      page: 1,
      pageSize: 8,
      userId: 'user-1',
      categories: ['technology'],
    });
    expect(textForModel).toContain('[search_communities');
    expect(textForModel).toContain('"resultKey": "C1"');
    expect(textForModel).toContain('Cộng đồng A');
    expect(clientActions).toHaveLength(1);
    expect(clientActions[0]).toMatchObject({
      type: 'show_community_results',
      payload: {
        source: 'search_communities',
        query: 'công nghệ',
        communities: [
          expect.objectContaining({
            resultKey: 'C1',
            groupId: 'g1',
            name: 'Cộng đồng A',
          }),
        ],
      },
    });
  });
});
