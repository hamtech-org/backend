import { messageService } from '../message.service.js';
import { conversationRepository } from '../../conversation/conversation.repository.js';
import { userRepository } from '@/modules/user/user.repository.js';
import { AppError } from '@/shared/utils/errors.js';

jest.mock('../../conversation/conversation.repository.js', () => ({
  conversationRepository: {
    getConversationById: jest.fn(),
    getConversationMembers: jest.fn(),
    createMessage: jest.fn(),
    updateConversationLastMessage: jest.fn(),
    updateMemberUnreadCount: jest.fn(),
  },
}));

jest.mock('../message-user-hide.repository.js', () => ({
  messageUserHideRepository: {
    queryHiddenMessageIdsForConversation: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('@/config/database.js', () => ({
  dynamoClient: {
    send: jest.fn(),
  },
}));

jest.mock('@/modules/user/user.repository.js', () => ({
  userRepository: {
    getBlockStatusBetween: jest.fn(),
    findByIds: jest.fn(),
  },
}));

jest.mock('@/modules/media/media.service.js', () => ({
  mediaService: {
    getMediaForMessageAttach: jest.fn(),
    resolveMediaFromAppDownloadUrl: jest.fn(),
  },
}));

jest.mock('@/shared/kafka/producer.js', () => ({
  kafkaProducer: {
    send: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('Message Service - Send Message Unit Tests', () => {
  const senderId = 'user-1';
  const receiverId = 'user-2';
  const conversationId = 'conv-1';
  const mockConv = {
    conversationId,
    type: 'direct',
  };
  const mockMembers = [{ userId: senderId }, { userId: receiverId }];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('TC01 (Pass): should send message successfully when not blocked', async () => {
    (conversationRepository.getConversationById as jest.Mock).mockResolvedValue(mockConv);
    (conversationRepository.getConversationMembers as jest.Mock).mockResolvedValue(mockMembers);
    (userRepository.getBlockStatusBetween as jest.Mock).mockResolvedValue('none');
    (userRepository.findByIds as jest.Mock).mockResolvedValue([
      { userId: senderId, displayName: 'User One' },
    ]);

    const result = await messageService.sendMessage(senderId, conversationId, {
      content: 'Hello World',
      type: 'text',
    });

    expect(result.content).toBe('Hello World');
    expect(conversationRepository.createMessage).toHaveBeenCalled();
  });

  it('TC02 (Pass): should throw error when blocked by other', async () => {
    (conversationRepository.getConversationById as jest.Mock).mockResolvedValue(mockConv);
    (conversationRepository.getConversationMembers as jest.Mock).mockResolvedValue(mockMembers);
    (userRepository.getBlockStatusBetween as jest.Mock).mockResolvedValue('blocked_by_other');

    await expect(
      messageService.sendMessage(senderId, conversationId, {
        content: 'Hello World',
        type: 'text',
      }),
    ).rejects.toThrow('Ban da bi chan boi nguoi dung nay.');
  });

  it('TC03 (Pass): should throw error when blocked by me', async () => {
    (conversationRepository.getConversationById as jest.Mock).mockResolvedValue(mockConv);
    (conversationRepository.getConversationMembers as jest.Mock).mockResolvedValue(mockMembers);
    (userRepository.getBlockStatusBetween as jest.Mock).mockResolvedValue('blocked_by_me');

    await expect(
      messageService.sendMessage(senderId, conversationId, {
        content: 'Hello World',
        type: 'text',
      }),
    ).rejects.toThrow('Ban dang chan nguoi dung nay');
  });

  it('TC04 (Pass): should throw error when blocked by other', async () => {
    (conversationRepository.getConversationById as jest.Mock).mockResolvedValue(mockConv);
    (conversationRepository.getConversationMembers as jest.Mock).mockResolvedValue(mockMembers);
    (userRepository.getBlockStatusBetween as jest.Mock).mockResolvedValue('blocked_by_other');

    await expect(
      messageService.sendMessage(senderId, conversationId, {
        content: 'Hello World',
        type: 'text',
      }),
    ).rejects.toThrow('Ban da bi chan boi nguoi dung nay');
  });
});
