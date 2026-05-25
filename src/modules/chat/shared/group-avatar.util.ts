import { conversationRepository } from '../conversation/conversation.repository.js';
import { normalizeGroupConversationAvatarStored } from '@/modules/media/mediaUrl.util.js';

export async function memberChangePayloadExtras(
  conversationId: string,
): Promise<{ avatar?: string; updatedAt?: string }> {
  try {
    const conv = await conversationRepository.getConversationById(conversationId);
    if (!conv) return {};
    return {
      avatar: normalizeGroupConversationAvatarStored(conv.avatar, conversationId),
      updatedAt: conv.updatedAt,
    };
  } catch (error) {
    console.error('[memberChangePayloadExtras] Error:', error);
    return {};
  }
}
