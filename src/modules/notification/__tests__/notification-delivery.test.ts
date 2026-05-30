import { notificationService } from '../notification.service.js';
import { notificationRepository } from '../notification.repository.js';
import { sendExpoPushToUser } from '../notification.push.js';
import { getIO } from '@/socket/index.js';

jest.mock('../notification.repository.js', () => ({
  notificationRepository: {
    create: jest.fn(),
    getUnreadCount: jest.fn(),
    getByUserId: jest.fn(),
    markAsRead: jest.fn(),
    markAllAsRead: jest.fn(),
  },
}));

jest.mock('../notification.push.js', () => ({
  sendExpoPushToUser: jest.fn(),
}));

jest.mock('@/socket/index.js', () => {
  const mockEmit = jest.fn();
  const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
  const mockIO = { to: mockTo };
  return {
    getIO: jest.fn().mockReturnValue(mockIO),
  };
});

describe('Notification Service - Notification Delivery Unit Tests', () => {
  const userId = 'user-123';
  const mockNotification = {
    notificationId: 'notif-1',
    userId,
    type: 'post_reaction' as const,
    title: 'New Like',
    body: 'Someone liked your post',
    data: { route: 'post' as const, id: 'post-1' },
    isRead: false,
    createdAt: new Date().toISOString(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('TC01 (Pass): dispatch should save notification and send push notification', async () => {
    (notificationRepository.create as jest.Mock).mockResolvedValue(mockNotification);
    (notificationRepository.getUnreadCount as jest.Mock).mockResolvedValue(5);

    const result = await notificationService.dispatch({
      userId,
      type: 'post_reaction',
      title: 'New Like',
      body: 'Someone liked your post',
      data: { route: 'post', id: 'post-1' },
      skipPush: false,
    });

    expect(notificationRepository.create).toHaveBeenCalled();
    expect(sendExpoPushToUser).toHaveBeenCalledWith(userId, 'New Like', 'Someone liked your post', {
      route: 'post',
      id: 'post-1',
    });
    expect(result.title).toBe('New Like');
  });

  it('TC02 (Pass): markAsRead should mark notification as read and emit unread count', async () => {
    (notificationRepository.getUnreadCount as jest.Mock).mockResolvedValue(2);

    await notificationService.markAsRead(userId, 'notif-1');

    expect(notificationRepository.markAsRead).toHaveBeenCalledWith(userId, 'notif-1');
    expect(notificationRepository.getUnreadCount).toHaveBeenCalledWith(userId);
  });

  it('TC03 (Pass): dispatch should skip push notification when skipPush is true', async () => {
    (notificationRepository.create as jest.Mock).mockResolvedValue(mockNotification);
    (notificationRepository.getUnreadCount as jest.Mock).mockResolvedValue(5);

    await notificationService.dispatch({
      userId,
      type: 'post_reaction',
      title: 'New Like',
      body: 'Someone liked your post',
      data: { route: 'post', id: 'post-1' },
      skipPush: true,
    });

    // This should pass because sendExpoPushToUser is skipped when skipPush is true.
    expect(sendExpoPushToUser).not.toHaveBeenCalled();
  });
});
