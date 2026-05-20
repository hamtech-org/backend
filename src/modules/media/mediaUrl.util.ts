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
