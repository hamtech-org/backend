import type { AiAssistantClientAction } from '../../shared/types/assistant.types.js';
import type { AiToolCall } from '../tools/execute-tools.js';
import { MAX_HISTORY_MESSAGE_CHARS, MAX_HISTORY_TRANSCRIPT_CHARS } from './pipeline.constants.js';

export type LlmJsonShape = {
  reply?: string;
  toolCalls?: AiToolCall[];
  messageResultIds?: string[];
  messageResultKeys?: string[];
  communityResultIds?: string[];
  communityResultKeys?: string[];
};

export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function decodeJsonStringLoose(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      )
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\');
  }
}

function extractReplyLoose(text: string): string {
  const match = text.match(/"reply"\s*:\s*"((?:\\.|[^"\\])*)"/s);
  return match?.[1] ? decodeJsonStringLoose(match[1]).trim() : '';
}

function unwrapNestedJsonReply(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.includes('"reply"')) return value;
  const parsed = parseJsonLoose(trimmed);
  return typeof parsed?.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim() : value;
}

export function parseJsonLoose(text: string): LlmJsonShape | null {
  const t = text.trim();
  if (!t) return null;
  try {
    const parsed = JSON.parse(t) as LlmJsonShape;
    if (typeof parsed.reply === 'string') parsed.reply = unwrapNestedJsonReply(parsed.reply);
    return parsed;
  } catch {
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(t.slice(start, end + 1)) as LlmJsonShape;
        if (typeof parsed.reply === 'string') parsed.reply = unwrapNestedJsonReply(parsed.reply);
        return parsed;
      } catch {
        const reply = extractReplyLoose(t.slice(start, end + 1));
        return reply ? { reply, toolCalls: [] } : null;
      }
    }
    const reply = extractReplyLoose(t);
    return reply ? { reply, toolCalls: [] } : null;
  }
}

export function buildHistoryTranscript(
  rows: Array<{ role: string; content: string }>,
  maxLines: number,
): string {
  const slice = rows.slice(-maxLines);
  const transcript = slice
    .map(
      (r) =>
        `${r.role === 'assistant' ? 'AI' : 'User'}: ${truncateText(
          r.content,
          MAX_HISTORY_MESSAGE_CHARS,
        )}`,
    )
    .join('\n');
  return truncateText(transcript, MAX_HISTORY_TRANSCRIPT_CHARS);
}

export type HistoryTurnRow = {
  messageId?: string;
  role: string;
  content: string;
};

export function normalizeQuestionText(text: string): string {
  return text.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isNearDuplicateQuestion(a: string, b: string): boolean {
  const na = normalizeQuestionText(a);
  const nb = normalizeQuestionText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const minLen = 8;
  if (na.length < minLen || nb.length < minLen) return na === nb;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (longer.includes(shorter)) {
    return shorter.length / longer.length >= 0.85;
  }
  return false;
}

/** Loại tin hiện tại và (nếu hỏi lại) cặp Q&A trùng trước đó để model không copy reply cũ. */
export function prepareHistoryForTurn(
  rows: HistoryTurnRow[],
  options: {
    excludeMessageId?: string;
    currentMessage: string;
    maxLines: number;
  },
): { transcript: string; isReAsk: boolean } {
  let working = rows.filter(
    (r) => !options.excludeMessageId || r.messageId !== options.excludeMessageId,
  );

  const isReAsk = working.some(
    (r) => r.role === 'user' && isNearDuplicateQuestion(r.content, options.currentMessage),
  );

  if (isReAsk) {
    const skipIds = new Set<string>();
    for (let i = 0; i < working.length; i++) {
      const row = working[i];
      if (row.role !== 'user' || !isNearDuplicateQuestion(row.content, options.currentMessage)) {
        continue;
      }
      if (row.messageId) skipIds.add(row.messageId);
      const next = working[i + 1];
      if (next?.role === 'assistant' && next.messageId) {
        skipIds.add(next.messageId);
      }
    }
    working = working.filter((r) => !r.messageId || !skipIds.has(r.messageId));
  }

  return {
    transcript: buildHistoryTranscript(working, options.maxLines),
    isReAsk,
  };
}

export function filterRagHitsForTurn<T extends { role: string; text: string }>(
  hits: T[],
  currentMessage: string,
  isReAsk: boolean,
): T[] {
  let filtered = hits.filter(
    (h) => !(h.role === 'user' && isNearDuplicateQuestion(h.text, currentMessage)),
  );
  if (isReAsk) {
    filtered = filtered.filter((h) => h.role !== 'assistant');
  }
  return filtered;
}

export function buildReAskInstruction(locale: 'vi' | 'en'): string {
  return locale === 'vi'
    ? 'LƯU Ý: User đang hỏi lại câu tương tự trước đó — coi là yêu cầu MỚI; trả lời lại từ đầu (cập nhật giờ/dữ liệu nếu cần), KHÔNG copy nguyên văn câu trả lời cũ.'
    : 'NOTE: The user is re-asking a similar question — treat as a NEW request; answer fresh (update time/data if needed), do NOT copy the previous reply verbatim.';
}

const INTERNAL_UUID_RE =
  /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;

/** Giữ nguyên URL / markdown link — không thay UUID trong href (tránh hỏng ảnh S3). */
const PRESERVE_URL_SEGMENTS_RE = /(\[[^\]]*\]\([^)]*\)|https?:\/\/[^\s]+)/gi;

export function sanitizeInternalIdsForUser(text: string): string {
  const replaceUuid = (chunk: string) => chunk.replace(INTERNAL_UUID_RE, 'thành viên');
  const parts: string[] = [];
  let lastIndex = 0;
  const re = new RegExp(PRESERVE_URL_SEGMENTS_RE.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    parts.push(replaceUuid(text.slice(lastIndex, match.index)));
    parts.push(match[0]);
    lastIndex = match.index + match[0].length;
  }
  parts.push(replaceUuid(text.slice(lastIndex)));
  return parts
    .join('')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const MARKDOWN_LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;

const IMAGE_LINK_LABEL =
  /^(?:link\s*(?:ảnh|anh)|(?:ảnh|anh)(?:\s*đại\s*diện|\s*dai\s*dien)?|xem\s*ảnh|xem\s*anh|avatar|image|photo|hình|hinh)$/iu;

function normalizeImageHrefForReply(href: string): string {
  const trimmed = href.trim().replace(/&amp;/g, '&');
  if (!/\s/.test(trimmed)) return trimmed;
  return trimmed.replace(/ /g, '%20');
}

function normalizeLinkLabelForReply(label: string): string {
  return label.normalize('NFC').trim();
}

function isImageLinkLabelForReply(label: string): boolean {
  const normalized = normalizeLinkLabelForReply(label);
  if (!normalized) return false;
  if (IMAGE_LINK_LABEL.test(normalized)) return true;
  const lower = normalized.toLowerCase();
  return /link.*(ảnh|anh)/u.test(lower) || /^(ảnh|anh|hình|hinh)\b/u.test(lower);
}

function isImageUrlForAssistantReply(url: string): boolean {
  const trimmed = normalizeImageHrefForReply(url);
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    if (/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(parsed.pathname)) return true;
    if (/\/avatars?\//i.test(parsed.pathname)) return true;
  } catch {
    /* ignore */
  }
  return (
    /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(trimmed) ||
    /\/avatars?\//i.test(trimmed) ||
    /zalogram-media/i.test(trimmed)
  );
}

/** Đổi markdown link trỏ ảnh thành cú pháp ảnh để client render thumbnail. */
export function convertImageLinksToMarkdownImages(text: string): string {
  return text.replace(MARKDOWN_LINK_RE, (full, label: string, href: string) => {
    const decodedHref = normalizeImageHrefForReply(href);
    if (isImageUrlForAssistantReply(decodedHref) || isImageLinkLabelForReply(label)) {
      return `![](${decodedHref})`;
    }
    return full;
  });
}

function normalizeMessageResultSelector(value: string): string {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '');
  if (/^\d+$/.test(normalized)) return `R${normalized}`;
  return normalized;
}

function normalizeCommunityResultSelector(value: string): string {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '');
  if (/^\d+$/.test(normalized)) return `C${normalized}`;
  return normalized;
}

export function filterMessageResultActions(
  actions: AiAssistantClientAction[],
  selectedKeysOrIds: string[],
): AiAssistantClientAction[] {
  const selected = new Set(
    selectedKeysOrIds.map((id) => normalizeMessageResultSelector(id)).filter(Boolean),
  );
  return actions
    .map((action) => {
      if (action.type !== 'show_message_results') return action;
      const fallbackMessages = action.payload.messages.slice(0, 5);
      const selectedMessages =
        selected.size > 0
          ? action.payload.messages.filter((message) => {
              const resultKey = message.resultKey
                ? normalizeMessageResultSelector(message.resultKey)
                : '';
              return (
                (resultKey && selected.has(resultKey)) ||
                selected.has(normalizeMessageResultSelector(message.messageId))
              );
            })
          : fallbackMessages;
      const messages = (selectedMessages.length > 0 ? selectedMessages : fallbackMessages).slice(
        0,
        5,
      );
      return {
        ...action,
        payload: {
          ...action.payload,
          messages,
        },
      };
    })
    .filter((action) => action.type !== 'show_message_results' || action.payload.messages.length);
}

export function filterCommunityResultActions(
  actions: AiAssistantClientAction[],
  selectedKeysOrIds: string[],
): AiAssistantClientAction[] {
  const selected = new Set(
    selectedKeysOrIds.map((id) => normalizeCommunityResultSelector(id)).filter(Boolean),
  );
  return actions
    .map((action) => {
      if (action.type !== 'show_community_results') return action;
      const fallbackCommunities = action.payload.communities.slice(0, 1);
      const selectedCommunities =
        selected.size > 0
          ? action.payload.communities.filter((community) => {
              const resultKey = community.resultKey
                ? normalizeCommunityResultSelector(community.resultKey)
                : '';
              return (
                (resultKey && selected.has(resultKey)) ||
                selected.has(normalizeCommunityResultSelector(community.groupId)) ||
                selected.has(normalizeCommunityResultSelector(community.communityId))
              );
            })
          : fallbackCommunities;
      const communities = (
        selectedCommunities.length > 0 ? selectedCommunities : fallbackCommunities
      ).slice(0, 5);
      return {
        ...action,
        payload: {
          ...action.payload,
          communities,
        },
      };
    })
    .filter(
      (action) => action.type !== 'show_community_results' || action.payload.communities.length,
    );
}

export function detectSensitiveUserInput(text: string): string[] {
  const normalized = text.normalize('NFKC');
  const lower = normalized.toLowerCase();
  const findings = new Set<string>();

  const checks: Array<[string, RegExp]> = [
    [
      'OTP/mã xác thực',
      /\b(?:otp|mã\s*(?:otp|xác\s*thực|xac\s*thuc|2fa|mfa|code)|verification\s*code|auth(?:entication)?\s*code)\b.{0,40}\b\d{4,8}\b/i,
    ],
    ['mật khẩu', /\b(?:password|pass|passwd|pwd|mật\s*khẩu|mat\s*khau)\b\s*[:=：-]?\s*\S{4,}/i],
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)?PRIVATE KEY-----/i],
    [
      'API key/token/secret',
      /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|refresh[_-]?token|bearer\s+token|client[_-]?secret|github[_-]?token|slack[_-]?token)\b\s*[:=：-]?\s*['"]?[A-Za-z0-9._~+/=-]{12,}/i,
    ],
    ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
    ['JWT/token', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
    ['SSH key', /\bssh-(?:rsa|ed25519)\s+[A-Za-z0-9+/=]{80,}/i],
  ];

  for (const [label, pattern] of checks) {
    if (pattern.test(normalized)) findings.add(label);
  }

  if (
    /\b\d{4,8}\b/.test(normalized) &&
    /\b(?:otp|2fa|mfa|xác\s*thực|xac\s*thuc|verify|verification|đăng\s*nhập|dang\s*nhap)\b/i.test(
      lower,
    )
  ) {
    findings.add('OTP/mã xác thực');
  }

  return [...findings];
}

export function buildSensitiveInputRefusal(findings: string[]): string {
  const labels = findings.length ? findings.join(', ') : 'thông tin nhạy cảm';
  return [
    `Mình không thể xử lý nội dung có ${labels}.`,
    'Bạn hãy xóa hoặc che các thông tin nhạy cảm như OTP, mật khẩu, private key, API key/token rồi gửi lại.',
  ].join('\n');
}
