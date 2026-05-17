import type { TimestampFields } from '@/shared/types/common.types.js';
import type {
  MessageType,
  ConversationType,
  MemberRole,
  MessageStatus,
} from '@/shared/types/chat.types.js';

/** Cài đặt nhóm (META conversation type group). */
export interface IGroupMemberPermissions {
  changeNameAvatar: boolean;
  pinMessages: boolean;
  createNotesReminders: boolean;
  createPolls: boolean;
  sendMessages: boolean;
}

export interface IGroupAdminSettings {
  approvalRequired: boolean;
  highlightLeaderMessages: boolean;
  newMembersReadRecent: boolean;
  allowJoinLink: boolean;
}

export interface IGroupSettings {
  memberPermissions: IGroupMemberPermissions;
  adminSettings: IGroupAdminSettings;
  /** Hậu tố link tham gia (demo / refresh). */
  joinLinkSuffix?: string;
}

export interface IConversation extends TimestampFields {
  conversationId: string;
  type: ConversationType;
  name?: string;
  avatar?: string;
  /** Historical creator. Do not update this when group ownership changes. */
  creatorId: string;
  /** Current group leader. For legacy rows without this field, the owner MEMBER# row is the fallback. */
  leaderId?: string;
  lastMessage?: ILastMessage;
  lastMessageAt?: string;
  memberCount: number;
  isEncrypted: boolean;
  isDeleted?: boolean;
  /** Chỉ nhóm; đồng bộ realtime qua socket `group:settings_updated`. */
  groupSettings?: IGroupSettings;
  /** META: số tin đang ghim trong hội thoại (đồng bộ khi ghim/bỏ ghim/thu hồi tin). */
  pinnedMessageCount?: number;
  /**
   * Trường gộp từ bản ghi MEMBER# của user đang gọi API (danh sách hội thoại / preferences).
   * Không lưu trên META.
   */
  unreadCount?: number;
  /**
   * MEMBER#: tắt thông báo push đến thời điểm (vd 1h, 8h). Client có thể dùng cùng `isMuted` hiệu lực.
   */
  notificationsMutedUntil?: string | null;
  isMuted?: boolean;
  /** Ghim hội thoại lên đầu danh sách (cá nhân, giống Zalo). */
  isPinnedToTop?: boolean;
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
  /** Tắt push tạm đến ISO time (hết hạn vẫn nhận tin/socket, chỉ không push). */
  notificationsMutedUntil?: string | null;
  /** Ghim cuộc trò chuyện lên đầu (theo user). */
  isPinnedToTop?: boolean;
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
  /**
   * Chat 1-1: tiến trình nhận từ phía người nhận (sent → delivered → read).
   * Chỉ có ý nghĩa trên tin của người gửi; không trả về cho đối phương qua API.
   */
  outboundStatus?: MessageStatus;
  /** Gộp khi trả API / socket: trạng thái hiển thị với người gửi (không lưu Dynamo). */
  status?: MessageStatus;
  /**
   * Chỉ trên tin của chính viewer: ai đã đọc (so `MEMBER.lastReadAt` với `createdAt` của tin).
   */
  readBy?: { userId: string; displayName?: string | null }[];
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
  role: Extract<MemberRole, 'admin' | 'member'>;
}

export interface IGroupRoleAuditLog {
  auditId: string;
  conversationId: string;
  actorUserId: string;
  targetUserId: string;
  previousRole: MemberRole;
  nextRole: MemberRole;
  action: 'transfer_owner' | 'change_role' | 'self_demote_admin' | 'owner_leave_transfer';
  createdAt: string;
  metadata?: Record<string, unknown>;
}
