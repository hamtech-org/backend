import type { TimestampFields } from '@/shared/types/common.types.js';
import type { MessageType, ConversationType, MemberRole } from '@/shared/types/chat.types.js';

export interface IConversation extends TimestampFields {
  conversationId: string;
  type: ConversationType;
  name: string | null;
  avatar: string | null;
  creatorId: string;
  lastMessage: ILastMessage | null;
  lastMessageAt: string | null;
  memberCount: number;
  isEncrypted: boolean;
}

export interface ILastMessage {
  messageId: string;
  senderId: string;
  content: string;
  type: MessageType;
  createdAt: string;
  senderDisplayName?: string | null;
}

export interface IConversationMember {
  conversationId: string;
  userId: string;
  role: MemberRole;
  joinedAt: string;
  lastReadAt: string | null;
  unreadCount: number;
  isMuted: boolean;
  nickname: string | null;
}

export interface IReplyToDetails {
  messageId: string;
  senderId: string;
  senderDisplayName: string | null;
  content: string;
  type: MessageType;
}

export interface IMessage extends TimestampFields {
  messageId: string;
  conversationId: string;
  senderId: string;
  senderDisplayName?: string | null;
  type: MessageType;
  content: string;
  encryptedContent: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  mediaSize: number | null;
  thumbnailUrl: string | null;
  replyTo: string | null;
  replyToDetails?: IReplyToDetails | null;
  forwardFrom: string | null;
  isPinned: boolean;
  isEdited: boolean;
  isRecalled: boolean;
  isDeleted: boolean;
  reactions: Record<string, string[]>;
}

export interface ICreateConversationDto {
  type: ConversationType;
  name?: string;
  memberIds: string[];
}

export interface ISendMessageDto {
  type: MessageType;
  content: string;
  mediaUrl?: string;
  replyTo?: string;
}
