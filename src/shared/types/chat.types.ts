export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'file'
  | 'sticker'
  | 'emoji'
  | 'location'
  | 'poll'
  | 'schedule'
  | 'call'
  | 'voice';
export type MessageStatus = 'sent' | 'delivered' | 'read';
export type ConversationType = 'direct' | 'group';
export type MemberRole = 'owner' | 'admin' | 'member';
