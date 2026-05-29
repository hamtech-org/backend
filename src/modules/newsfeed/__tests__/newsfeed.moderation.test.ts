import { newsfeedService } from '../newsfeed.service.js';
import { newsfeedRepository } from '../newsfeed.repository.js';
import { communityService } from '@/modules/community/community.service.js';
import { automodService } from '@/modules/community/automod.service.js';
import { AppError } from '@/shared/utils/errors.js';

// Mock các dependencies
jest.mock('../newsfeed.repository.js', () => ({
  newsfeedRepository: {
    createPost: jest.fn(),
    getPostById: jest.fn(),
    updatePost: jest.fn(),
    createComment: jest.fn(),
    updateComment: jest.fn(),
    getCommentById: jest.fn(),
  },
}));

jest.mock('@/modules/user/user.repository.js', () => ({
  userRepository: {
    findMultipleById: jest.fn().mockResolvedValue([
      { userId: 'user-1', displayName: 'User 1', avatar: null },
      { userId: 'user-2', displayName: 'User 2', avatar: null },
    ]),
    findById: jest.fn().mockResolvedValue({
      userId: 'user-2',
      displayName: 'User 2',
      avatar: null,
    }),
  },
}));

jest.mock('@/modules/notification/notification.service.js', () => ({
  notificationService: {
    dispatch: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock('@/socket/index.js', () => ({
  getIO: jest.fn().mockReturnValue({
    to: jest.fn().mockReturnValue({
      emit: jest.fn(),
    }),
  }),
}));

jest.mock('@/modules/community/community.service.js', () => ({
  communityService: {
    assertActiveMember: jest.fn(),
    getCommunity: jest.fn(),
    addContentIndex: jest.fn(),
  },
}));

jest.mock('@/modules/community/automod.service.js', () => ({
  automodService: {
    moderateMessage: jest.fn(),
  },
}));

// Mock Kafka
jest.mock('@/config/kafka.js', () => ({
  getKafkaProducer: jest.fn().mockReturnValue({
    send: jest.fn().mockResolvedValue({}),
  }),
}));

describe('Newsfeed Service - AutoMod Moderation Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createPost Moderation', () => {
    it('nên chặn đăng bài viết trong cộng đồng nếu có từ cấm ở chế độ BLOCK', async () => {
      // Mock active member check và community settings
      (communityService.assertActiveMember as jest.Mock).mockResolvedValue({
        role: 'member',
      } as any);
      (communityService.getCommunity as jest.Mock).mockResolvedValue({
        isPostApprovalRequired: false,
      } as any);

      // Mock AutoMod trả về block
      (automodService.moderateMessage as jest.Mock).mockResolvedValue({
        allowed: false,
        content: 'Nội dung chứa badword',
        action: 'block',
      });

      await expect(
        newsfeedService.createPost('user-1', {
          content: 'Nội dung chứa badword',
          type: 'text',
          visibility: 'public',
          publicationStatus: 'published',
          groupId: 'group-1',
        }),
      ).rejects.toThrow(
        new AppError(
          'Nội dung bài viết vi phạm tiêu chuẩn cộng đồng của nhóm.',
          403,
          'POST_BLOCKED_BY_AUTOMOD',
        ),
      );

      expect(automodService.moderateMessage).toHaveBeenCalledWith({
        groupId: 'group-1',
        conversationId: '',
        senderId: 'user-1',
        content: 'Nội dung chứa badword',
        messageType: 'text',
      });
      expect(newsfeedRepository.createPost).not.toHaveBeenCalled();
    });

    it('nên che từ cấm bài viết trong cộng đồng nếu có từ cấm ở chế độ CENSOR', async () => {
      (communityService.assertActiveMember as jest.Mock).mockResolvedValue({
        role: 'member',
      } as any);
      (communityService.getCommunity as jest.Mock).mockResolvedValue({
        isPostApprovalRequired: false,
      } as any);

      // Mock AutoMod trả về censor
      (automodService.moderateMessage as jest.Mock).mockResolvedValue({
        allowed: true,
        content: 'Chào ***',
        action: 'censor',
        matchedKeywords: ['***'],
      });

      const result = await newsfeedService.createPost('user-1', {
        content: 'Chào badword',
        type: 'text',
        visibility: 'public',
        publicationStatus: 'published',
        groupId: 'group-1',
      });

      expect(result.content).toBe('Chào ***');
      expect(newsfeedRepository.createPost).toHaveBeenCalled();
    });

    it('nên bypass kiểm duyệt nếu bài viết không thuộc cộng đồng (không có groupId)', async () => {
      const result = await newsfeedService.createPost('user-1', {
        content: 'Chào badword',
        type: 'text',
        visibility: 'public',
        publicationStatus: 'published',
      });

      expect(automodService.moderateMessage).not.toHaveBeenCalled();
      expect(newsfeedRepository.createPost).toHaveBeenCalled();
    });
  });

  describe('updatePost Moderation', () => {
    it('nên chặn cập nhật bài viết trong cộng đồng nếu nội dung sửa chứa từ cấm ở chế độ BLOCK', async () => {
      (newsfeedRepository.getPostById as jest.Mock).mockResolvedValue({
        postId: 'post-1',
        authorId: 'user-1',
        groupId: 'group-1',
        content: 'Nội dung cũ sạch',
      } as any);

      (automodService.moderateMessage as jest.Mock).mockResolvedValue({
        allowed: false,
        content: 'Sửa chứa badword',
        action: 'block',
      });

      await expect(
        newsfeedService.updatePost('post-1', 'user-1', {
          content: 'Sửa chứa badword',
        }),
      ).rejects.toThrow(
        new AppError(
          'Nội dung chỉnh sửa bài viết vi phạm tiêu chuẩn cộng đồng của nhóm.',
          403,
          'POST_BLOCKED_BY_AUTOMOD',
        ),
      );

      expect(newsfeedRepository.updatePost).not.toHaveBeenCalled();
    });

    it('nên che từ cấm khi sửa bài viết trong cộng đồng ở chế độ CENSOR', async () => {
      (newsfeedRepository.getPostById as jest.Mock).mockResolvedValue({
        postId: 'post-1',
        authorId: 'user-1',
        groupId: 'group-1',
        content: 'Nội dung cũ sạch',
      } as any);

      (automodService.moderateMessage as jest.Mock).mockResolvedValue({
        allowed: true,
        content: 'Sửa chứa ***',
        action: 'censor',
      });

      await newsfeedService.updatePost('post-1', 'user-1', {
        content: 'Sửa chứa badword',
      });

      expect(newsfeedRepository.updatePost).toHaveBeenCalledWith(
        'post-1',
        expect.objectContaining({
          content: 'Sửa chứa ***',
        }),
      );
    });
  });

  describe('addComment Moderation', () => {
    it('nên chặn bình luận bài viết thuộc cộng đồng nếu chứa từ cấm ở chế độ BLOCK', async () => {
      (newsfeedRepository.getPostById as jest.Mock).mockResolvedValue({
        postId: 'post-1',
        groupId: 'group-1',
      } as any);

      // Mock getPostById trong newsfeedService (kiểm tra quyền xem bài)
      jest.spyOn(newsfeedService, 'getPostById').mockResolvedValue({
        postId: 'post-1',
        groupId: 'group-1',
        authorId: 'user-2',
        content: 'Bài viết',
        type: 'text',
        visibility: 'public',
        reactionsCount: {},
        commentsCount: 0,
        sharesCount: 0,
        viewsCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as any);

      (automodService.moderateMessage as jest.Mock).mockResolvedValue({
        allowed: false,
        content: 'Bình luận badword',
        action: 'block',
      });

      await expect(
        newsfeedService.addComment('post-1', 'user-1', 'Bình luận badword'),
      ).rejects.toThrow(
        new AppError(
          'Bình luận của bạn vi phạm tiêu chuẩn cộng đồng của nhóm.',
          403,
          'COMMENT_BLOCKED_BY_AUTOMOD',
        ),
      );

      expect(newsfeedRepository.createComment).not.toHaveBeenCalled();
    });

    it('nên che từ cấm khi bình luận bài viết thuộc cộng đồng ở chế độ CENSOR', async () => {
      (newsfeedRepository.getPostById as jest.Mock).mockResolvedValue({
        postId: 'post-1',
        groupId: 'group-1',
      } as any);

      jest.spyOn(newsfeedService, 'getPostById').mockResolvedValue({
        postId: 'post-1',
        groupId: 'group-1',
        authorId: 'user-2',
        content: 'Bài viết',
        type: 'text',
        visibility: 'public',
        reactionsCount: {},
        commentsCount: 0,
        sharesCount: 0,
        viewsCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as any);

      (automodService.moderateMessage as jest.Mock).mockResolvedValue({
        allowed: true,
        content: 'Bình luận ***',
        action: 'censor',
      });

      const result = await newsfeedService.addComment('post-1', 'user-1', 'Bình luận badword');

      expect(result.content).toBe('Bình luận ***');
      expect(newsfeedRepository.createComment).toHaveBeenCalled();
    });
  });
});
