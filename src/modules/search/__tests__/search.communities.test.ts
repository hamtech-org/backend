import { searchService } from '../search.service.js';
import { esClient } from '@/config/elasticsearch.js';
import { communityRepository } from '@/modules/community/community.repository.js';

jest.mock('@/config/elasticsearch.js', () => ({
  esClient: {
    search: jest.fn(),
  },
}));

jest.mock('@/modules/community/community.repository.js', () => ({
  communityRepository: {
    batchGetMembers: jest.fn(),
  },
}));

const esSearchMock = esClient.search as jest.Mock;
const batchGetMembersMock = communityRepository.batchGetMembers as jest.Mock;

describe('searchCommunities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('only returns community documents and filters out chat-only groups', async () => {
    esSearchMock.mockResolvedValue({
      hits: {
        total: { value: 2 },
        hits: [
          {
            _source: {
              groupId: 'comm-1',
              communityId: 'comm-1',
              name: 'Tech VN',
              description: 'Lap trinh',
              slug: 'tech-vn',
              category: 'technology',
              memberCount: 10,
              type: 'public',
            },
          },
          {
            _source: {
              groupId: 'chat-only',
              name: 'Nhom chat',
              description: 'Khong phai cong dong',
              memberCount: 3,
              type: 'group',
            },
          },
        ],
      },
    });

    const result = await searchService.searchCommunities({
      query: 'tech',
      userId: 'user-1',
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.groupId).toBe('comm-1');
    expect(result.items[0]?.communityId).toBe('comm-1');
  });

  it('uses match_all when query is wildcard for community suggestions', async () => {
    esSearchMock.mockResolvedValue({
      hits: {
        total: { value: 1 },
        hits: [
          {
            _source: {
              groupId: 'comm-1',
              communityId: 'comm-1',
              name: 'Tech VN',
              description: 'Lap trinh',
              slug: 'tech-vn',
              category: 'technology',
              memberCount: 10,
              type: 'public',
            },
          },
        ],
      },
    });

    const result = await searchService.searchCommunities({
      query: '*',
      userId: 'user-1',
      categories: ['technology'],
    });

    expect(esSearchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          bool: {
            must: [{ match_all: {} }],
            filter: expect.arrayContaining([
              { term: { isActive: true } },
              { term: { status: 'active' } },
              { term: { category: 'technology' } },
            ]),
          },
        },
      }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.groupId).toBe('comm-1');
  });

  it('keeps only direct matches when a specific community keyword is provided', async () => {
    esSearchMock.mockResolvedValue({
      hits: {
        total: { value: 3 },
        hits: [
          {
            _source: {
              groupId: 'hamtech',
              communityId: 'hamtech',
              name: 'Cong dong Hamtech',
              description: 'Noi trao doi cua Hamtech',
              slug: 'hamtech',
              category: 'technology',
              memberCount: 10,
              type: 'public',
            },
          },
          {
            _source: {
              groupId: 'tech-general',
              communityId: 'tech-general',
              name: 'Goi y cong dong ve cong nghe',
              description: 'Lap trinh, AI, web, mobile va cloud',
              slug: 'cong-nghe',
              category: 'technology',
              memberCount: 20,
              type: 'public',
            },
          },
          {
            _source: {
              groupId: 'sports',
              communityId: 'sports',
              name: 'Cong dong The Duc The Thao',
              description: 'The thao moi ngay',
              slug: 'the-thao',
              category: 'sports',
              memberCount: 30,
              type: 'public',
            },
          },
        ],
      },
    });

    const result = await searchService.searchCommunities({
      query: 'Hamtech',
      userId: 'user-1',
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.groupId).toBe('hamtech');
    expect(result.total).toBe(1);
    expect(result.hasMore).toBe(false);
  });

  it('hides private communities when the user is not an active member', async () => {
    esSearchMock.mockResolvedValue({
      hits: {
        total: { value: 1 },
        hits: [
          {
            _source: {
              groupId: 'priv-1',
              communityId: 'priv-1',
              name: 'Private Club',
              slug: 'private-club',
              memberCount: 5,
              type: 'private',
            },
          },
        ],
      },
    });
    batchGetMembersMock.mockResolvedValue([]);

    const result = await searchService.searchCommunities({
      query: 'private',
      userId: 'user-1',
    });

    expect(result.items).toHaveLength(0);
    expect(batchGetMembersMock).toHaveBeenCalledWith(['priv-1'], 'user-1');
  });

  it('shows private communities when the user is an active member', async () => {
    esSearchMock.mockResolvedValue({
      hits: {
        total: { value: 1 },
        hits: [
          {
            _source: {
              groupId: 'priv-1',
              communityId: 'priv-1',
              name: 'Private Club',
              slug: 'private-club',
              memberCount: 5,
              type: 'private',
            },
          },
        ],
      },
    });
    batchGetMembersMock.mockResolvedValue([{ groupId: 'priv-1', status: 'active' }]);

    const result = await searchService.searchCommunities({
      query: 'private',
      userId: 'user-1',
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.name).toBe('Private Club');
  });
});
