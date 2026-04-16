import { v4 as uuidv4 } from 'uuid';
import { conversationRepository } from './conversation.repository.js';
import { messageUserHideRepository } from '../message/message-user-hide.repository.js';
import type {
  IConversation,
  IConversationMember,
  IMessage,
  ICreateConversationDto,
} from '../shared/chat.types.js';
import { NotFoundError, ForbiddenError } from '@/shared/utils/errors.js';
import { userRepository } from '@/modules/user/user.repository.js';
import { resolveLastVisibleLastMessageSnapshot } from '../shared/chat.helpers.js';
import { createAndBroadcastSystemMessage } from '../shared/system-message.factory.js';

export const conversationService = {
  getConversations: async (userId: string): Promise<IConversation[]> => {
    const conversations = await conversationRepository.getConversations(userId);
    const hiddenByConv =
      await messageUserHideRepository.queryAllHiddenGroupedByConversation(userId);
    for (const conv of conversations) {
      const lm = conv.lastMessage;
      if (!lm?.messageId) continue;
      const hidden = hiddenByConv.get(conv.conversationId);
      if (!hidden?.has(lm.messageId)) continue;
      const resolved = await resolveLastVisibleLastMessageSnapshot(
        conv.conversationId,
        hidden,
        conversationRepository.getMessages,
      );
      if (resolved) conv.lastMessage = resolved;
      else delete conv.lastMessage;
    }

    const directConversations = conversations.filter(
      (conversation) => conversation.type === 'direct',
    );

    if (directConversations.length === 0) {
      return conversations;
    }

    const membersPerConversation = await Promise.all(
      directConversations.map((conversation) =>
        conversationRepository.getConversationMembers(conversation.conversationId),
      ),
    );

    const otherUserIds = [
      ...new Set(
        membersPerConversation.flatMap((members) =>
          members.filter((member) => member.userId !== userId).map((member) => member.userId),
        ),
      ),
    ];

    const otherUsers = await userRepository.findByIds(otherUserIds);
    const userMap = new Map(otherUsers.map((user) => [user.userId, user]));

    directConversations.forEach((conversation, index) => {
      const otherMember = membersPerConversation[index].find((member) => member.userId !== userId);
      if (!otherMember) return;

      const otherUser = userMap.get(otherMember.userId);
      if (!otherUser) return;

      conversation.name = otherUser.displayName;
      conversation.avatar = otherUser.avatar ?? undefined;
      (conversation as IConversation & { otherUserId?: string }).otherUserId = otherMember.userId;
    });

    return conversations;
  },

  /**
   * Tạo conversation mới (direct hoặc group).
   * Với direct: kiểm tra đã tồn tại conv 1-1 chưa, nếu có thì trả về conv cũ.
   */
  createConversation: async (
    creatorId: string,
    data: ICreateConversationDto,
  ): Promise<IConversation> => {
    const allMemberIds = Array.from(new Set([creatorId, ...data.memberIds]));

    // Với direct chat, tìm conv đã tồn tại
    if (data.type === 'direct' && allMemberIds.length === 2) {
      const otherId = allMemberIds.find((id) => id !== creatorId)!;
      const existing = await conversationRepository.findDirectConversation(creatorId, otherId);
      if (existing) return existing;
    }

    const now = new Date().toISOString();
    const conversationId = uuidv4();

    const conversation: IConversation = {
      conversationId,
      type: data.type,
      ...(data.name != null && data.name !== '' ? { name: data.name } : {}),
      creatorId,
      memberCount: allMemberIds.length,
      isEncrypted: false,
      createdAt: now,
      updatedAt: now,
    };

    await conversationRepository.createConversation(conversation);

    // Thêm tất cả thành viên
    await Promise.all(
      allMemberIds.map((userId, index) => {
        const member: IConversationMember = {
          conversationId,
          userId,
          role: index === 0 ? 'owner' : 'member',
          joinedAt: now,
          unreadCount: 0,
          isMuted: false,
        };
        return conversationRepository.addConversationMember(member);
      }),
    );

    // Tạo system message thông báo tạo nhóm mới
    if (data.type === 'group') {
      let creatorName = 'Ai đó';
      try {
        const users = await userRepository.findByIds([creatorId]);
        creatorName = users[0]?.displayName || 'Ai đó';
      } catch {}

      try {
        await createAndBroadcastSystemMessage(
          {
            conversationId,
            senderId: creatorId,
            content: `${creatorName} đã tạo nhóm${data.name ? ` "${data.name}"` : ''}`,
          },
          {
            createMessage: conversationRepository.createMessage,
            updateConversationLastMessage: conversationRepository.updateConversationLastMessage,
          },
        );
      } catch {
        /* ignore system message errors */
      }
    }

    return conversation;
  },

  getConversationById: async (conversationId: string, userId: string): Promise<IConversation> => {
    const conversation = await conversationRepository.getConversationById(conversationId);
    if (!conversation) throw new NotFoundError('Hội thoại');

    // Kiểm tra user có phải thành viên không
    const members = await conversationRepository.getConversationMembers(conversationId);
    const isMember = members.some((m) => m.userId === userId);
    if (!isMember) throw new ForbiddenError('Bạn không phải thành viên của hội thoại này');

    return conversation;
  },
};
