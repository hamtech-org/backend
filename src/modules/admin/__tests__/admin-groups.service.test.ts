import { adminCrudService } from '../admin.crud.service.js';
import { adminCrudRepository } from '../admin.crud.repository.js';
import { communityRepository } from '@/modules/community/community.repository.js';
import { conversationRepository } from '@/modules/chat/conversation/conversation.repository.js';
import { conversationService } from '@/modules/chat/conversation/conversation.service.js';
import { userRepository } from '@/modules/user/user.repository.js';
import { adminRepository } from '../admin.repository.js';
import type { ICommunity } from '@/modules/community/community.types.js';

jest.mock('../admin.crud.repository.js', () => ({
  adminCrudRepository: {
    scanCommunityMetas: jest.fn(),
    scanGroupMetas: jest.fn(),
    getCommunityMeta: jest.fn(),
    updateCommunityFields: jest.fn(),
    archiveCommunityAsAdmin: jest.fn(),
    scanUserProfiles: jest.fn(),
    scanPostMetas: jest.fn(),
    updateUserRole: jest.fn(),
    softDeleteUser: jest.fn(),
    updateUserFields: jest.fn(),
  },
}));

jest.mock('@/modules/community/community.repository.js', () => ({
  padMs: (value: number) => value.toString().padStart(13, '0'),
  communityRepository: {
    createCommunity: jest.fn(),
  },
}));

jest.mock('@/modules/chat/conversation/conversation.service.js', () => ({
  conversationService: {
    createConversation: jest.fn(),
  },
}));

jest.mock('@/modules/chat/conversation/conversation.repository.js', () => ({
  conversationRepository: {
    getConversationById: jest.fn(),
    getConversationMembers: jest.fn(),
    updateConversation: jest.fn(),
    removeMember: jest.fn(),
  },
}));

jest.mock('@/modules/auth/auth.repository.js', () => ({
  authRepository: {
    findUserByEmail: jest.fn(),
    createUser: jest.fn(),
    incrementTokenVersion: jest.fn(),
    deleteAllUserSessions: jest.fn(),
  },
}));

jest.mock('@/modules/user/user.repository.js', () => ({
  userRepository: {
    findById: jest.fn(),
    findByIds: jest.fn(),
  },
}));

jest.mock('../admin.repository.js', () => ({
  adminRepository: {
    createModerationLog: jest.fn(),
  },
}));

jest.mock('@/modules/newsfeed/newsfeed.repository.js', () => ({
  newsfeedRepository: {
    getPostById: jest.fn(),
    createPost: jest.fn(),
    updatePost: jest.fn(),
    deletePost: jest.fn(),
  },
}));

const adminCrudRepositoryMock = adminCrudRepository as typeof adminCrudRepository & {
  scanGroupMetas: jest.Mock;
};
const communityRepositoryMock = communityRepository as jest.Mocked<typeof communityRepository>;

jest.mock('@/modules/newsfeed/newsfeed.service.js', () => ({
  newsfeedService: {
    createPost: jest.fn(),
  },
}));

jest.mock('@/modules/community/community.service.js', () => ({
  communityService: {
    archiveCommunity: jest.fn(),
  },
}));

const activeCommunity: ICommunity = {
  groupId: 'group-1',
  communityId: 'group-1',
  name: 'Hamtech Dev',
  slug: 'hamtech-dev',
  description: 'Dev community',
  avatar: null,
  coverUrl: null,
  category: 'technology',
  type: 'public',
  joinPolicy: 'open',
  creatorId: 'owner-1',
  ownerId: 'owner-1',
  memberCount: 3,
  postCount: 0,
  popularityScore: 0,
  isApprovalRequired: false,
  isPostApprovalRequired: false,
  conversationId: null,
  chatEnabled: true,
  isActive: true,
  status: 'active',
  createdAt: '2026-06-01T00:00:00.000Z',
  createdAtMs: 1780275600000,
  updatedAt: '2026-06-01T00:00:00.000Z',
};

const archivedCommunity: ICommunity = {
  ...activeCommunity,
  groupId: 'group-2',
  communityId: 'group-2',
  name: 'Archived Group',
  slug: 'archived-group',
  ownerId: 'owner-2',
  isActive: false,
  status: 'archived',
};

describe('adminCrudService groups', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(adminCrudRepository.scanCommunityMetas).mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    jest.mocked(communityRepository.createCommunity).mockResolvedValue(undefined);
    jest.mocked(adminCrudRepository.updateCommunityFields).mockResolvedValue(undefined);
    jest.mocked(adminCrudRepository.archiveCommunityAsAdmin).mockResolvedValue(undefined);
    jest.mocked(adminRepository.createModerationLog).mockResolvedValue(undefined);
    jest
      .mocked(userRepository.findByIds)
      .mockResolvedValue([{ userId: 'owner-1', displayName: 'Owner One' }] as never);
  });

  it('lists groups from the Groups table repository, not Conversations', async () => {
    jest.mocked(adminCrudRepository.scanCommunityMetas).mockResolvedValue({
      items: [activeCommunity, archivedCommunity],
      nextCursor: null,
    });

    const result = await adminCrudService.listGroups({
      query: 'dev',
      status: 'active',
      limit: 50,
    });

    expect(adminCrudRepository.scanCommunityMetas).toHaveBeenCalledWith(50, undefined);
    expect(adminCrudRepositoryMock.scanGroupMetas).not.toHaveBeenCalled();
    expect(result.items).toEqual([
      expect.objectContaining({
        groupId: 'group-1',
        name: 'Hamtech Dev',
        ownerDisplayName: 'Owner One',
        status: 'active',
        isDeleted: false,
      }),
    ]);
  });

  it('creates a community meta and owner member without creating a chat conversation', async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      userId: 'owner-1',
      displayName: 'Owner One',
      isDeleted: false,
    } as never);

    const result = await adminCrudService.createGroup('admin-1', {
      name: 'Admin Community',
      description: 'Created by admin',
      ownerId: 'owner-1',
    });

    expect(communityRepository.createCommunity).toHaveBeenCalledTimes(1);
    const [community, ownerMember] = communityRepositoryMock.createCommunity.mock.calls[0] as [
      ICommunity,
      unknown,
    ];
    expect(community).toEqual(
      expect.objectContaining({
        groupId: expect.any(String),
        communityId: community.groupId,
        name: 'Admin Community',
        description: 'Created by admin',
        category: 'general',
        type: 'public',
        joinPolicy: 'open',
        ownerId: 'owner-1',
        status: 'active',
        isActive: true,
        chatEnabled: true,
      }),
    );
    expect(ownerMember).toEqual(
      expect.objectContaining({
        groupId: community.groupId,
        communityId: community.groupId,
        userId: 'owner-1',
        role: 'owner',
        status: 'active',
        GSI1PK: 'USER#owner-1',
      }),
    );
    expect(conversationService.createConversation).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        groupId: community.groupId,
        name: 'Admin Community',
        ownerDisplayName: 'Owner One',
      }),
    );
  });

  it('updates community meta fields through the Groups table repository', async () => {
    jest
      .mocked(adminCrudRepository.getCommunityMeta)
      .mockResolvedValueOnce(activeCommunity)
      .mockResolvedValueOnce({
        ...activeCommunity,
        name: 'Renamed Community',
        description: null,
      });

    await adminCrudService.updateGroup('admin-1', 'group-1', {
      name: 'Renamed Community',
      description: '',
      status: 'active',
    });

    expect(adminCrudRepository.updateCommunityFields).toHaveBeenCalledWith(
      'group-1',
      {
        name: 'Renamed Community',
        description: null,
        status: 'active',
        isActive: true,
      },
      ['deletedAt', 'deletedBy'],
    );
    expect(conversationRepository.updateConversation).not.toHaveBeenCalled();
  });

  it('archives communities without disbanding chat conversations', async () => {
    jest.mocked(adminCrudRepository.getCommunityMeta).mockResolvedValue(activeCommunity);
    const { communityService } = await import('@/modules/community/community.service.js');

    await adminCrudService.deleteGroup('admin-1', 'group-1');

    expect(communityService.archiveCommunity).toHaveBeenCalledWith('admin-1', 'group-1', true);
  });
});
