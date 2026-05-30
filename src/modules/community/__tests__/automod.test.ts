import { automodService, escapeRegex } from '../automod.service';
import { communityRepository } from '../community.repository';
import { getRedis } from '@/config/redis';

// Mock communityRepository và getRedis
jest.mock('../community.repository', () => ({
  communityRepository: {
    getCommunityById: jest.fn(),
  },
}));

jest.mock('@/config/redis', () => {
  const mockRedis = {
    get: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
  };
  return {
    getRedis: jest.fn().mockReturnValue(mockRedis),
  };
});

describe('Automod Service Unit Tests', () => {
  let redisMock: any;

  beforeEach(() => {
    jest.clearAllMocks();
    redisMock = getRedis();
    // Mặc định cache miss
    redisMock.get.mockResolvedValue(null);
  });

  describe('escapeRegex Utility', () => {
    it('nên escape tất cả các ký tự đặc biệt của regex', () => {
      const input = 'hello.*+?^${}()|[]\\world';
      const output = escapeRegex(input);
      expect(output).toBe('hello\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\world');
    });
  });

  describe('moderateMessage - AutoMod Disabled', () => {
    it('nên bypass tin nhắn nếu Auto-Mod tắt', async () => {
      (communityRepository.getCommunityById as jest.Mock).mockResolvedValue({
        autoModerateEnabled: false,
        autoModerateAction: 'censor',
        blacklistedKeywords: ['tục_tĩu'],
      });

      const result = await automodService.moderateMessage({
        groupId: 'group-1',
        conversationId: 'conv-1',
        senderId: 'user-1',
        content: 'Đây là tin nhắn chứa từ tục_tĩu',
        messageType: 'text',
      });

      expect(result.allowed).toBe(true);
      expect(result.content).toBe('Đây là tin nhắn chứa từ tục_tĩu');
      expect(result.action).toBeUndefined();
    });
  });

  describe('moderateMessage - Censor Mode', () => {
    beforeEach(() => {
      (communityRepository.getCommunityById as jest.Mock).mockResolvedValue({
        autoModerateEnabled: true,
        autoModerateAction: 'censor',
        blacklistedKeywords: ['sex', 'từ cấm', 'chửi thề', 'đm'],
      });
    });

    it('nên che từ cấm bằng dấu * và không phân biệt hoa thường', async () => {
      const result = await automodService.moderateMessage({
        groupId: 'group-1',
        conversationId: 'conv-1',
        senderId: 'user-1',
        content: 'Chào cậu, SEX là gì thế? Đm nữa chứ!',
        messageType: 'text',
      });

      expect(result.allowed).toBe(true);
      expect(result.content).toBe('Chào cậu, *** là gì thế? ** nữa chứ!');
      expect(result.action).toBe('censor');
      expect(result.matchedKeywords).toEqual(['***']);
    });

    it('nên che từ cấm có khoảng trắng tiếng Việt chuẩn xác', async () => {
      const result = await automodService.moderateMessage({
        groupId: 'group-1',
        conversationId: 'conv-1',
        senderId: 'user-1',
        content: 'Không được nói từ cấm hay chửi thề trong này.',
        messageType: 'text',
      });

      expect(result.allowed).toBe(true);
      expect(result.content).toBe('Không được nói ****** hay ******** trong này.');
      expect(result.action).toBe('censor');
    });

    it('không được False Positive (không match substring vô hại)', async () => {
      const result = await automodService.moderateMessage({
        groupId: 'group-1',
        conversationId: 'conv-1',
        senderId: 'user-1',
        // 'sex' cấm, nhưng 'Sussex' hoặc 'sexology' vô hại
        content: 'Tôi sống ở Sussex và rất thích nghiên cứu sexology.',
        messageType: 'text',
      });

      expect(result.allowed).toBe(true);
      expect(result.content).toBe('Tôi sống ở Sussex và rất thích nghiên cứu sexology.');
      expect(result.action).toBeUndefined();
    });
  });

  describe('moderateMessage - Block Mode', () => {
    beforeEach(() => {
      (communityRepository.getCommunityById as jest.Mock).mockResolvedValue({
        autoModerateEnabled: true,
        autoModerateAction: 'block',
        blacklistedKeywords: ['spam', 'quảng cáo'],
      });
    });

    it('nên chặn gửi tin nhắn nếu có từ cấm', async () => {
      const result = await automodService.moderateMessage({
        groupId: 'group-1',
        conversationId: 'conv-1',
        senderId: 'user-1',
        content: 'Đừng có spam ở đây nhé!',
        messageType: 'text',
      });

      expect(result.allowed).toBe(false);
      expect(result.action).toBe('block');
    });

    it('cho phép gửi tin nhắn nếu không có từ cấm', async () => {
      const result = await automodService.moderateMessage({
        groupId: 'group-1',
        conversationId: 'conv-1',
        senderId: 'user-1',
        content: 'Chào mọi người, chúc một ngày tốt lành.',
        messageType: 'text',
      });

      expect(result.allowed).toBe(true);
      expect(result.action).toBeUndefined();
    });

    it('TC07 (Pass): should allow message if messageType is sticker even if content contains blacklisted keywords', async () => {
      const result = await automodService.moderateMessage({
        groupId: 'group-1',
        conversationId: 'conv-1',
        senderId: 'user-1',
        content: 'spam',
        messageType: 'sticker',
      });

      expect(result.allowed).toBe(true);
    });
  });
});
