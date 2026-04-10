import type { TimestampFields } from '@/shared/types/common.types.js';
import type { MessageType, ConversationType, MemberRole } from '@/shared/types/chat.types.js';

export interface IConversation extends TimestampFields {
  conversationId: string;
  type: ConversationType;
  name?: string;
  avatar?: string;
  creatorId: string;
  lastMessage?: ILastMessage;
  lastMessageAt?: string;
  memberCount: number;
  isEncrypted: boolean;
  isDeleted?: boolean;
}

export interface ILastMessage {
  messageId: string;
  senderId: string;
  content: string;
  type: MessageType;
  createdAt: string;
}

export interface IConversationMember {
  conversationId: string;
  userId: string;
  role: MemberRole;
  joinedAt: string;
  lastReadAt?: string;
  unreadCount: number;
  isMuted: boolean;
  nickname?: string;
}

export interface IMessage extends TimestampFields {
  messageId: string;
  conversationId: string;
  senderId: string;
  type: MessageType;
  content: string;
  encryptedContent?: string;
  mediaUrl?: string;
  mediaType?: string;
  mediaSize?: number;
  thumbnailUrl?: string;
  replyTo?: string;
  forwardFrom?: string;
  isPinned: boolean;
  isEdited: boolean;
  isRecalled: boolean;
  isDeleted: boolean;
  reactions: Record<string, string[]>;
}

export interface ICreateConversationDto {
  type: ConversationType;
  name?: string;
  avatar?: string;
  memberIds: string[];
}

export interface IUpdateGroupDto {
  name?: string;
  avatar?: string;
}

export interface IGroupMember {
  conversationId: string;
  userId: string;
  name: string;
  avatar?: string;
  role: MemberRole;
  joinedAt: string;
}

export interface ISendMessageDto {
  type: MessageType;
  content: string;
  mediaUrl?: string;
  replyTo?: string;
}
