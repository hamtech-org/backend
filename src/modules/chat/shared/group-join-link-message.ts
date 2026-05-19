export const GROUP_JOIN_LINK_KIND = 'group_join_link' as const;

/** Một dòng preview cho lastMessage / sidebar khi tin là link mời nhóm (JSON). */
export function formatGroupJoinLinkListPreview(content: string): string | null {
  const trimmed = (content ?? '').trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const obj = JSON.parse(trimmed) as { kind?: string; groupName?: string };
    if (obj?.kind !== GROUP_JOIN_LINK_KIND) return null;
    const groupName = String(obj.groupName ?? '').trim() || 'Nhóm chat';
    return `Link mời tham gia nhóm: ${groupName}`;
  } catch {
    return null;
  }
}
