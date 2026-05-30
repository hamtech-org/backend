import { communityService } from '../community.service.js';
import { communityRepository } from '../community.repository.js';
import { ConflictError } from '@/shared/utils/errors.js';

jest.mock('../community.repository.js', () => {
  const actual = jest.requireActual('../community.repository.js');
  return {
    ...actual,
    communityRepository: {
      createCommunity: jest.fn().mockResolvedValue(undefined),
      getCommunityById: jest.fn(),
      getMember: jest.fn(),
      getJoinRequest: jest.fn().mockResolvedValue(null),
      getInvitation: jest.fn().mockResolvedValue(null),
    },
  };
});

jest.mock('@/config/database.js', () => ({
  dynamoClient: {},
}));

jest.mock('@/modules/chat/conversation/conversation.service.js', () => ({
  conversationService: {
    createConversation: jest.fn().mockResolvedValue({ conversationId: 'conv-1' }),
  },
}));

jest.mock('@/config/kafka.js', () => ({
  getKafkaProducer: jest.fn().mockReturnValue({
    send: jest.fn().mockResolvedValue(undefined),
  }),
}));

describe('Community Service - Community Creation Unit Tests', () => {
  const ownerId = 'user-owner';
  const data = {
    name: 'New Community',
    slug: 'new-community',
    type: 'public' as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('TC01 (Pass): should successfully create community with unique slug', async () => {
    (communityRepository.getCommunityById as jest.Mock).mockResolvedValue({
      groupId: 'group-id',
      isActive: true,
    });
    (communityRepository.getMember as jest.Mock).mockResolvedValue({
      userId: ownerId,
      status: 'active',
      role: 'owner',
    });

    const result = await communityService.createCommunity(ownerId, data);

    expect(result.name).toBe('New Community');
    expect(result.slug).toBe('new-community');
    expect(communityRepository.createCommunity).toHaveBeenCalled();
  });

  it('TC02 (Pass): createCommunity should throw ConflictError when slug is duplicated', async () => {
    // Simulate database duplicate error
    const dbError = new Error('Transaction Canceled');
    dbError.name = 'TransactionCanceledException';
    (communityRepository.createCommunity as jest.Mock).mockRejectedValue(dbError);

    await expect(communityService.createCommunity(ownerId, data)).rejects.toThrow(
      'Slug cộng đồng đã tồn tại',
    );
  });

  it('TC03 (Pass): createCommunity should throw ConflictError when slug is duplicated', async () => {
    const dbError = new Error('Transaction Canceled');
    dbError.name = 'TransactionCanceledException';
    (communityRepository.createCommunity as jest.Mock).mockRejectedValue(dbError);

    await expect(communityService.createCommunity(ownerId, data)).rejects.toThrow(
      'Slug cộng đồng đã tồn tại',
    );
  });
});
