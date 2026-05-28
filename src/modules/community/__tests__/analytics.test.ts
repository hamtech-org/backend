import { communityService } from '../community.service';
import { communityRepository } from '../community.repository';
import { newsfeedRepository } from '@/modules/newsfeed/newsfeed.repository';
import { esClient } from '@/config/elasticsearch';
import { ForbiddenError } from '@/shared/utils/errors';
import type { ICommunityAnalyticsPoint } from '../community.types';

// Mock repositories and services
jest.mock('../community.repository', () => ({
  communityRepository: {
    getAnalyticsTrend: jest.fn(),
    listContentIndex: jest.fn(),
    getCommunityById: jest.fn(),
  },
}));

jest.mock('@/modules/newsfeed/newsfeed.repository', () => ({
  newsfeedRepository: {
    getPostById: jest.fn(),
  },
}));

jest.mock('@/config/elasticsearch', () => ({
  esClient: {
    search: jest.fn(),
  },
}));

// Mock assertCommunityRole to return a complete mock of ICommunityMember
jest.spyOn(communityService, 'assertCommunityRole').mockImplementation(async (actorId, groupId) => {
  if (actorId === 'user-unauthorized') {
    throw new ForbiddenError('Bạn không có quyền thực hiện hành động này');
  }
  return {
    groupId,
    communityId: groupId,
    userId: actorId,
    role: 'moderator',
    status: 'active',
    joinedAt: new Date().toISOString(),
    joinedAtMs: Date.now(),
    createdAt: new Date().toISOString(),
    createdAtMs: Date.now(),
  };
});

describe('Community Analytics Service Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getCommunityAnalytics - Access Authorization', () => {
    it('should throw ForbiddenError if the actor does not have moderator role or higher', async () => {
      // Mock communityRepository.getCommunityById to avoid failing in requireActiveCommunity
      (communityRepository.getCommunityById as jest.Mock).mockResolvedValue({
        groupId: 'group-1',
        communityId: 'group-1',
        name: 'Test Community',
        slug: 'test-comm',
        type: 'public',
        joinPolicy: 'open',
        creatorId: 'user-owner',
        ownerId: 'user-owner',
        memberCount: 15,
        postCount: 8,
        conversationId: 'conv-1',
        chatEnabled: true,
        isActive: true,
        status: 'active',
        createdAt: new Date().toISOString(),
        createdAtMs: Date.now(),
        updatedAt: new Date().toISOString(),
      });

      await expect(
        communityService.getCommunityAnalytics('user-unauthorized', 'group-1', 30),
      ).rejects.toThrow('Bạn không có quyền thực hiện hành động này');
    });

    it('should successfully return analytics dashboard if authorized', async () => {
      // Mock communityRepository.getCommunityById
      (communityRepository.getCommunityById as jest.Mock).mockResolvedValue({
        groupId: 'group-1',
        communityId: 'group-1',
        name: 'Test Community',
        slug: 'test-comm',
        type: 'public',
        joinPolicy: 'open',
        creatorId: 'user-owner',
        ownerId: 'user-owner',
        memberCount: 15,
        postCount: 8,
        conversationId: 'conv-1',
        chatEnabled: true,
        isActive: true,
        status: 'active',
        createdAt: new Date().toISOString(),
        createdAtMs: Date.now(),
        updatedAt: new Date().toISOString(),
      });

      // Mock getAnalyticsTrend to return sample daily data
      (communityRepository.getAnalyticsTrend as jest.Mock).mockResolvedValue([
        {
          date: new Date().toISOString().split('T')[0],
          newMembersCount: 2,
          leftMembersCount: 0,
          postsCount: 1,
          commentsCount: 3,
        },
      ]);

      // Mock Elasticsearch search for message aggregation
      (esClient.search as jest.Mock).mockResolvedValue({
        aggregations: {
          messages_by_day: {
            buckets: [
              {
                key_as_string: new Date().toISOString().split('T')[0] + 'T00:00:00.000Z',
                key: Date.now(),
                doc_count: 10,
              },
            ],
          },
        },
      });

      // Mock listContentIndex and newsfeedRepository to return empty posts
      (communityRepository.listContentIndex as jest.Mock).mockResolvedValue({
        items: [],
      });

      const result = await communityService.getCommunityAnalytics('user-moderator', 'group-1', 7);

      expect(result).toBeDefined();
      expect(result.groupId).toBe('group-1');
      expect(result.summary.totalMembers).toBe(15);
      expect(result.summary.totalPosts).toBe(8);
      expect(result.summary.totalMessages).toBe(10);
      expect(result.trend.length).toBe(7); // default size filled

      const todayStr = new Date().toISOString().split('T')[0];
      const todayTrend = result.trend.find((t: ICommunityAnalyticsPoint) => t.date === todayStr);
      expect(todayTrend).toBeDefined();
      expect(todayTrend?.newMembers).toBe(2);
      expect(todayTrend?.messages).toBe(10);
    });
  });
});
