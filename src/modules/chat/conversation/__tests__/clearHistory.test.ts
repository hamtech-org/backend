import { conversationService } from '../conversation.service.js';
import { conversationRepository } from '../conversation.repository.js';
import {
  emitConversationDeletedForMe,
  emitConversationCreatedToUser,
} from '../../shared/chat.broadcast.js';
import { NotFoundError, ForbiddenError } from '@/shared/utils/errors.js';
import { userRepository } from '@/modules/user/user.repository.js';

import { messageUserHideRepository } from '../../message/message-user-hide.repository.js';

// Mock dependencies
jest.mock('../conversation.repository.js', () => ({
  conversationRepository: {
    getConversationById: jest.fn(),
    getMember: jest.fn(),
    listRecentMessages: jest.fn(),
    updateMemberPreferences: jest.fn(),
    resetMemberUnreadCount: jest.fn(),
    revealConversationForUser: jest.fn(),
    getConversations: jest.fn(),
    getConversationMembers: jest.fn(),
    getMessages: jest.fn(),
    findDirectConversation: jest.fn(),
  },
}));

jest.mock('@/modules/user/user.repository.js', () => ({
  userRepository: {
    hasBlockBetween: jest.fn(),
  },
}));

jest.mock('../../message/message-user-hide.repository.js', () => ({
  messageUserHideRepository: {
    queryAllHiddenGroupedByConversation: jest.fn(),
    queryHiddenMessageIdsForConversation: jest.fn(),
  },
}));

jest.mock('../../shared/chat.broadcast.js', () => ({
  emitConversationDeletedForMe: jest.fn(),
  emitConversationCreatedToUser: jest.fn(),
}));

describe('Conversation Service - clearConversationHistoryForUser', () => {
  const userId = 'user-123';
  const conversationId = 'conv-456';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should throw NotFoundError if conversation does not exist', async () => {
    (conversationRepository.getConversationById as jest.Mock).mockResolvedValue(null);

    await expect(
      conversationService.clearConversationHistoryForUser(userId, conversationId),
    ).rejects.toThrow('Hội thoại không tồn tại');

    expect(conversationRepository.getConversationById).toHaveBeenCalledWith(conversationId);
  });

  it('should throw ForbiddenError if user is not a member of the conversation', async () => {
    (conversationRepository.getConversationById as jest.Mock).mockResolvedValue({
      conversationId,
      type: 'direct',
    });
    (conversationRepository.getMember as jest.Mock).mockResolvedValue(null);

    await expect(
      conversationService.clearConversationHistoryForUser(userId, conversationId),
    ).rejects.toThrow('Bạn không phải thành viên của hội thoại này');

    expect(conversationRepository.getMember).toHaveBeenCalledWith(conversationId, userId);
  });

  it('should clear conversation history with clearedUntilSK of the latest message', async () => {
    const mockConv = {
      conversationId,
      type: 'direct',
    };
    const mockMember = {
      conversationId,
      userId,
    };
    const mockLatestMessage = {
      messageId: 'msg-999',
      SK: 'MSG#1780000000000#msg-999',
      createdAt: '2026-05-29T00:00:00.000Z',
    };

    (conversationRepository.getConversationById as jest.Mock).mockResolvedValue(mockConv);
    (conversationRepository.getMember as jest.Mock).mockResolvedValue(mockMember);
    (conversationRepository.listRecentMessages as jest.Mock).mockResolvedValue([mockLatestMessage]);
    (conversationRepository.updateMemberPreferences as jest.Mock).mockResolvedValue(undefined);
    (conversationRepository.resetMemberUnreadCount as jest.Mock).mockResolvedValue(undefined);
    (emitConversationDeletedForMe as jest.Mock).mockResolvedValue(undefined);

    const result = await conversationService.clearConversationHistoryForUser(
      userId,
      conversationId,
    );

    expect(conversationRepository.listRecentMessages).toHaveBeenCalledWith(conversationId, {
      limit: 1,
    });
    expect(conversationRepository.updateMemberPreferences).toHaveBeenCalledWith(
      conversationId,
      userId,
      expect.objectContaining({
        clearedUntilSK: 'MSG#1780000000000#msg-999',
      }),
    );
    expect(conversationRepository.resetMemberUnreadCount).toHaveBeenCalledWith(
      conversationId,
      userId,
    );
    expect(emitConversationDeletedForMe).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        conversationId,
        type: 'direct',
        shouldHideFromList: true,
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        conversationId,
        type: 'direct',
        hiddenFromList: true,
      }),
    );
  });

  it('should handle clearing history when there are no messages in the conversation', async () => {
    const mockConv = {
      conversationId,
      type: 'group',
    };
    const mockMember = {
      conversationId,
      userId,
    };

    (conversationRepository.getConversationById as jest.Mock).mockResolvedValue(mockConv);
    (conversationRepository.getMember as jest.Mock).mockResolvedValue(mockMember);
    (conversationRepository.listRecentMessages as jest.Mock).mockResolvedValue([]);
    (conversationRepository.updateMemberPreferences as jest.Mock).mockResolvedValue(undefined);
    (conversationRepository.resetMemberUnreadCount as jest.Mock).mockResolvedValue(undefined);
    (emitConversationDeletedForMe as jest.Mock).mockResolvedValue(undefined);

    const result = await conversationService.clearConversationHistoryForUser(
      userId,
      conversationId,
    );

    expect(conversationRepository.updateMemberPreferences).toHaveBeenCalledWith(
      conversationId,
      userId,
      expect.objectContaining({
        clearedUntilSK: null,
      }),
    );
    expect(emitConversationDeletedForMe).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        conversationId,
        type: 'group',
        shouldHideFromList: true,
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        conversationId,
        type: 'group',
        hiddenFromList: true,
      }),
    );
  });
});

describe('Conversation Service - revealConversationForUser', () => {
  const userId = 'user-123';
  const conversationId = 'conv-456';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should call repository to reveal conversation for user', async () => {
    (conversationRepository.revealConversationForUser as jest.Mock).mockResolvedValue(undefined);

    await conversationService.revealConversationForUser(conversationId, userId);

    expect(conversationRepository.revealConversationForUser).toHaveBeenCalledWith(
      conversationId,
      userId,
      expect.any(String),
      expect.any(Number),
    );
  });
});

describe('Conversation Service - lastMessage filtering on cleared history', () => {
  const userId = 'user-123';
  const conversationId = 'conv-456';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getConversations', () => {
    it('should remove lastMessage if its createdAt is older than or equal to clearedAtMs', async () => {
      const mockConversations = [
        {
          conversationId,
          type: 'group',
          lastMessageAt: '2026-05-29T00:00:00.000Z',
          clearedAt: '2026-05-29T01:00:00.000Z',
          clearedAtMs: Date.parse('2026-05-29T01:00:00.000Z'),
          revealedAt: '2026-05-29T02:00:00.000Z',
          revealedAtMs: Date.parse('2026-05-29T02:00:00.000Z'),
          lastMessage: {
            messageId: 'msg-1',
            content: 'Hello',
            createdAt: '2026-05-29T00:00:00.000Z',
          },
        },
      ];

      (conversationRepository.getConversations as jest.Mock).mockResolvedValue(mockConversations);
      (
        messageUserHideRepository.queryAllHiddenGroupedByConversation as jest.Mock
      ).mockResolvedValue(new Map());

      const result = await conversationService.getConversations(userId);

      expect(result[0].lastMessage).toBeUndefined();
    });

    it('should keep lastMessage if its createdAt is newer than clearedAtMs', async () => {
      const mockConversations = [
        {
          conversationId,
          type: 'group',
          lastMessageAt: '2026-05-29T02:00:00.000Z',
          clearedAt: '2026-05-29T01:00:00.000Z',
          clearedAtMs: Date.parse('2026-05-29T01:00:00.000Z'),
          lastMessage: {
            messageId: 'msg-2',
            content: 'World',
            createdAt: '2026-05-29T02:00:00.000Z',
          },
        },
      ];

      (conversationRepository.getConversations as jest.Mock).mockResolvedValue(mockConversations);
      (
        messageUserHideRepository.queryAllHiddenGroupedByConversation as jest.Mock
      ).mockResolvedValue(new Map());

      const result = await conversationService.getConversations(userId);

      expect(result[0].lastMessage).toBeDefined();
      expect(result[0].lastMessage?.content).toBe('World');
    });
  });

  describe('getConversationById', () => {
    it('should remove lastMessage if its createdAt is older than or equal to clearedAtMs', async () => {
      const mockConv = {
        conversationId,
        type: 'group',
        lastMessage: {
          messageId: 'msg-1',
          content: 'Hello',
          createdAt: '2026-05-29T00:00:00.000Z',
        },
      };

      const mockMembers = [
        {
          userId,
          unreadCount: 0,
          clearedAt: '2026-05-29T01:00:00.000Z',
          clearedAtMs: Date.parse('2026-05-29T01:00:00.000Z'),
        },
      ];

      (conversationRepository.getConversationById as jest.Mock).mockResolvedValue(mockConv);
      (conversationRepository.getConversationMembers as jest.Mock).mockResolvedValue(mockMembers);
      (
        messageUserHideRepository.queryHiddenMessageIdsForConversation as jest.Mock
      ).mockResolvedValue(new Set());

      const result = await conversationService.getConversationById(conversationId, userId);

      expect(result.lastMessage).toBeUndefined();
    });
  });
});

describe('Conversation Service - createConversation for existing direct chat', () => {
  const creatorId = 'user-123';
  const otherId = 'user-456';
  const conversationId = 'conv-direct-789';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should reveal direct conversation and notify user when it already exists', async () => {
    const mockExistingConv = {
      conversationId,
      type: 'direct',
    };

    (userRepository.hasBlockBetween as jest.Mock).mockResolvedValue(false);
    (conversationRepository.findDirectConversation as jest.Mock).mockResolvedValue(
      mockExistingConv,
    );
    (conversationRepository.revealConversationForUser as jest.Mock).mockResolvedValue(undefined);
    (conversationRepository.getConversationById as jest.Mock).mockResolvedValue({
      ...mockExistingConv,
      revealedAt: '2026-05-29T10:00:00.000Z',
      revealedAtMs: Date.parse('2026-05-29T10:00:00.000Z'),
    });
    (conversationRepository.getConversationMembers as jest.Mock).mockResolvedValue([
      {
        userId: creatorId,
        unreadCount: 0,
        clearedAt: '2026-05-29T00:00:00.000Z',
        clearedAtMs: Date.parse('2026-05-29T00:00:00.000Z'),
      },
      { userId: otherId, unreadCount: 0 },
    ]);
    (messageUserHideRepository.queryHiddenMessageIdsForConversation as jest.Mock).mockResolvedValue(
      new Set(),
    );
    (emitConversationCreatedToUser as jest.Mock).mockResolvedValue(undefined);

    const result = await conversationService.createConversation(creatorId, {
      type: 'direct',
      memberIds: [otherId],
    });

    expect(conversationRepository.findDirectConversation).toHaveBeenCalledWith(creatorId, otherId);
    expect(conversationRepository.revealConversationForUser).toHaveBeenCalledWith(
      conversationId,
      creatorId,
      expect.any(String),
      expect.any(Number),
    );
    expect(emitConversationCreatedToUser).toHaveBeenCalledWith(
      creatorId,
      expect.objectContaining({
        conversationId,
        type: 'direct',
      }),
    );
    expect(result.conversationId).toBe(conversationId);
  });
});
