import type { AiToolCall } from './execute-tools.js';

const CATEGORY_FROM_MESSAGE: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /công nghệ|cong nghe|technology|\btech\b/i, category: 'technology' },
  { pattern: /thể thao|the thao|sports/i, category: 'sports' },
  { pattern: /âm nhạc|am nhac|music/i, category: 'music' },
  { pattern: /giáo dục|giao duc|education/i, category: 'education' },
  { pattern: /\bgame\b|gaming/i, category: 'gaming' },
  { pattern: /đời sống|doi song|lifestyle/i, category: 'lifestyle' },
];

function inferCategory(userMessage: string): string | undefined {
  for (const { pattern, category } of CATEGORY_FROM_MESSAGE) {
    if (pattern.test(userMessage)) return category;
  }
  return undefined;
}

function isGenericCommunityRequest(message: string): boolean {
  return (
    /(cộng đồng|cong dong|community)/iu.test(message) &&
    /(gợi ý|goi y|đề xuất|de xuat|tìm|tim|kiếm|kiem|cho tôi|cho toi|giúp|giup|muốn|muon|\d+\s*cộng đồng|một cộng đồng|vài cộng đồng)/iu.test(
      message,
    )
  );
}

function stripCommunityIntentWords(userMessage: string): string {
  return userMessage
    .normalize('NFC')
    .replace(
      /gợi ý|goi y|đề xuất|de xuat|tìm|tim|kiếm|kiem|cộng đồng|cong dong|community|cho tôi|cho toi|giúp tôi|giup toi|bạn hãy|ban hay|hãy|hay|về|ve|liên quan|lien quan|phù hợp|phu hop|một|mot|vài|vai|\d+/giu,
      ' ',
    )
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isOnlyCategoryPhrase(text: string, category?: string): boolean {
  if (!category || !text) return false;
  return CATEGORY_FROM_MESSAGE.some(
    ({ pattern, category: candidate }) => candidate === category && pattern.test(text),
  );
}

/** Query model đưa có vẻ bịa (vd. "Tech Enthusiasts") khi user không hề nhắc. */
export function shouldOverrideCommunitySearchQuery(
  userMessage: string,
  modelQuery: unknown,
): boolean {
  const q = typeof modelQuery === 'string' ? modelQuery.trim() : '';
  if (!q || q === '*') return false;
  const userLower = userMessage.toLowerCase();
  const qLower = q.toLowerCase();
  if (userLower.includes(qLower)) return false;
  if (qLower.length <= 3) return false;
  const looksEnglishInvented =
    /^[a-z0-9\s'-]+$/i.test(q) &&
    !/[àáạảãâầấậẩăằắặẳèéẹẻẽêềếệểìíịỉĩòóọỏõôồốộổơờớợởùúụủũưừứựửỳýỵỷỹđ]/u.test(q);
  return looksEnglishInvented || isGenericCommunityRequest(userMessage);
}

/** Args mặc định khi user chỉ xin gợi ý chung, không nêu tên cộng đồng. */
export function inferCommunitySearchArgs(userMessage: string): {
  query: string;
  category?: string;
} {
  const category = inferCategory(userMessage);
  const stripped = stripCommunityIntentWords(userMessage);

  if (stripped.length >= 2 && !isOnlyCategoryPhrase(stripped, category)) {
    return { query: stripped.slice(0, 200), ...(category ? { category } : {}) };
  }
  if (isGenericCommunityRequest(userMessage)) {
    return category ? { query: '*', category } : { query: '*' };
  }
  return category ? { query: '*', category } : { query: '*' };
}

export function normalizeCommunityToolCall(userMessage: string, call: AiToolCall): AiToolCall {
  if (call.name !== 'search_communities') return call;
  const inferred = inferCommunitySearchArgs(userMessage);
  const modelQuery = call.args?.query;
  if (shouldOverrideCommunitySearchQuery(userMessage, modelQuery)) {
    return { name: 'search_communities', args: { ...inferred } };
  }
  const q = typeof modelQuery === 'string' ? modelQuery.trim() : '';
  if (!q) {
    return { name: 'search_communities', args: { ...inferred, ...call.args } };
  }
  return call;
}
