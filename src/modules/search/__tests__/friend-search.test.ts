import { searchService } from '../search.service.js';
import { userRepository } from '@/modules/user/user.repository.js';
import { esClient } from '@/config/elasticsearch.js';

jest.mock('@/config/elasticsearch.js', () => ({
  esClient: {
    search: jest.fn(),
  },
}));

jest.mock('@/modules/user/user.repository.js', () => ({
  userRepository: {
    getFriendIds: jest.fn(),
    getPendingRequests: jest.fn(),
    checkFriendship: jest.fn(),
  },
}));

describe('Search Service - Friend Search Unit Tests', () => {
  const currentUserId = 'user-1';
  const query = 'john';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('TC01 (Pass): searchUsers should return correct matched users with friendship status', async () => {
    const mockHits = [
      {
        _source: {
          userId: 'user-2',
          displayName: 'John Doe',
          email: 'john@test.com',
          avatar: 'avatar.png',
          bio: 'Hello',
        },
      },
    ];

    (esClient.search as jest.Mock).mockResolvedValue({
      hits: {
        hits: mockHits,
        total: 1,
      },
    });

    (userRepository.getFriendIds as jest.Mock).mockResolvedValue(['user-2']);
    (userRepository.getPendingRequests as jest.Mock).mockResolvedValue({ received: [], sent: [] });
    (userRepository.checkFriendship as jest.Mock).mockResolvedValue(true);

    const result = await searchService.searchUsers({ query, userId: currentUserId });

    expect(result.items.length).toBe(1);
    expect(result.items[0].userId).toBe('user-2');
    expect(result.items[0].friendshipStatus).toBe('friend');
    expect(result.items[0].isFriend).toBe(true);
  });

  it('TC02 (Pass): searchUsers should fallback to status none if friendship check throws an error', async () => {
    const mockHits = [
      {
        _source: {
          userId: 'user-2',
          displayName: 'John Doe',
          email: 'john@test.com',
        },
      },
    ];

    (esClient.search as jest.Mock).mockResolvedValue({
      hits: {
        hits: mockHits,
        total: 1,
      },
    });

    (userRepository.getFriendIds as jest.Mock).mockRejectedValue(new Error('DB Error'));

    const result = await searchService.searchUsers({ query, userId: currentUserId });

    expect(result.items.length).toBe(1);
    expect(result.items[0].isFriend).toBe(false);
  });

  it('TC03 (Pass): searchUsers should filter out the current user from search results', async () => {
    const mockHits = [
      {
        _source: {
          userId: currentUserId,
          displayName: 'Current User',
          email: 'current@test.com',
        },
      },
    ];

    (esClient.search as jest.Mock).mockResolvedValue({
      hits: {
        hits: mockHits,
        total: 1,
      },
    });

    const result = await searchService.searchUsers({ query, userId: currentUserId });

    // The current user should be filtered out, so result.items should not contain currentUserId
    expect(result.items.some((u) => u.userId === currentUserId)).toBe(false);
  });
});
