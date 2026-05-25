/** Trích mediaId từ URL download app: `.../api/v{n}/media/{uuid}/download`. */
export function parseMediaIdFromAppDownloadUrl(urlStr: string): string | null {
  const trimmed = (urlStr ?? '').trim();
  if (!trimmed) return null;
  try {
    const u = /^https?:\/\//i.test(trimmed)
      ? new URL(trimmed)
      : new URL(trimmed, 'http://local.invalid');
    const pathname = u.pathname.replace(/\/+$/, '');
    const m = pathname.match(
      /\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/download$/i,
    );
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Trích mediaId từ URL thumbnail app. */
export function parseMediaIdFromAppThumbnailUrl(urlStr: string): string | null {
  const trimmed = (urlStr ?? '').trim();
  if (!trimmed) return null;
  try {
    const u = /^https?:\/\//i.test(trimmed)
      ? new URL(trimmed)
      : new URL(trimmed, 'http://local.invalid');
    const pathname = u.pathname.replace(/\/+$/, '');
    const m = pathname.match(
      /\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/thumbnail$/i,
    );
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Trích mediaId từ URL object CloudFront/S3: `<scope>/<uploaderId>/<mediaId>/original|thumb`. */
export function parseMediaIdFromObjectUrl(urlStr: string): string | null {
  const trimmed = (urlStr ?? '').trim();
  if (!trimmed) return null;
  try {
    const u = /^https?:\/\//i.test(trimmed)
      ? new URL(trimmed)
      : new URL(trimmed, 'http://local.invalid');
    const pathname = u.pathname.replace(/\/+$/, '');
    const m = pathname.match(
      /\/(?:chat|public)\/[^/]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(?:original|thumb)\b/i,
    );
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Trích mediaId từ mọi URL media nội bộ hỗ trợ. */
export function extractMediaIdFromUrl(urlStr: string | null | undefined): string | null {
  if (!urlStr?.trim()) return null;
  return (
    parseMediaIdFromAppDownloadUrl(urlStr) ??
    parseMediaIdFromAppThumbnailUrl(urlStr) ??
    parseMediaIdFromObjectUrl(urlStr)
  );
}

/** Trích xuất S3 key từ URL (hỗ trợ public/avatars/ và các key public khác) */
export function extractS3KeyFromUrl(urlStr: string | null | undefined): string | null {
  if (!urlStr?.trim()) return null;
  const trimmed = urlStr.trim();
  try {
    if (trimmed.startsWith('public/avatars/')) {
      return trimmed.split('?')[0];
    }
    const u = /^https?:\/\//i.test(trimmed)
      ? new URL(trimmed)
      : new URL(trimmed, 'http://local.invalid');
    const pathname = decodeURIComponent(u.pathname);
    const index = pathname.indexOf('public/avatars/');
    if (index !== -1) {
      return pathname.slice(index);
    }
  } catch {
    // ignore
  }
  return null;
}

const GROUP_CONVERSATION_AVATAR_PATH = /\/(?:api\/v\d+\/)?chat\/conversations\/([^/]+)\/avatar$/i;

/**
 * Chuẩn hóa avatar nhóm lưu DB / emit socket — path tương đối, không phụ thuộc host client.
 */
export function normalizeGroupConversationAvatarStored(
  avatar: string | null | undefined,
  conversationId: string,
): string {
  const cid = String(conversationId ?? '').trim();
  const fallback = cid ? `/api/v1/chat/conversations/${cid}/avatar` : '';
  const trimmed = (avatar ?? '').trim();
  if (!trimmed) return fallback;

  const mediaId = extractMediaIdFromUrl(trimmed);
  if (mediaId) return `/api/v1/media/${mediaId}/download`;

  let pathOnly = trimmed.split('?')[0];
  try {
    if (/^https?:\/\//i.test(trimmed)) pathOnly = new URL(trimmed).pathname;
  } catch {
    /* keep pathOnly */
  }

  if (GROUP_CONVERSATION_AVATAR_PATH.test(pathOnly) && cid) {
    return `/api/v1/chat/conversations/${cid}/avatar`;
  }

  if (pathOnly.startsWith('/api/')) return pathOnly;
  return trimmed;
}
