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
  senderDisplayName?: string | null;
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

export interface IReplyToDetails {
  messageId: string;
  senderId: string;
  senderDisplayName: string | null;
  content: string;
  type: MessageType;
  /** Preview ảnh/video trong dải trích dẫn (client dùng thumbnail khi có). */
  mediaUrl?: string | null;
  thumbnailUrl?: string | null;
  mediaType?: string | null;
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
  mediaOriginalName: string | null;
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
  mediaId?: string;
  replyTo?: string;
}

export interface IReactMessageDto {
  conversationId: string;
  createdAt: string;
  emoji: string;
}
export interface IAddMembersDto {
  memberIds: string[];
}

export interface IChangeRoleDto {
  role: MemberRole;
}
