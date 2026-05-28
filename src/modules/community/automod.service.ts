import { getRedis } from '@/config/redis.js';
import { logger } from '@/shared/utils/logger.js';
import { communityRepository } from './community.repository.js';
import type { ModerateMessageInput, ModerateMessageResult } from './community.types.js';

export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Lấy cấu hình Auto-Mod từ Redis Cache, nếu miss thì load từ DB và lưu lại vào cache
 */
export async function getAutomodConfigWithCache(groupId: string): Promise<{
  autoModerateEnabled: boolean;
  autoModerateAction: 'censor' | 'block';
  blacklistedKeywords: string[];
} | null> {
  const cacheKey = `group:automod:${groupId}`;
  try {
    const redis = getRedis();
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (err) {
    logger.warn(`[AutoMod Cache] Lỗi đọc Redis cho group ${groupId}:`, err);
  }

  // Cache miss, load from DB
  const community = await communityRepository.getCommunityById(groupId);
  if (!community) return null;

  const config = {
    autoModerateEnabled: community.autoModerateEnabled ?? false,
    autoModerateAction: community.autoModerateAction ?? 'censor',
    blacklistedKeywords: community.blacklistedKeywords ?? [],
  };

  try {
    const redis = getRedis();
    // Cache trong 1 giờ (3600 giây)
    await redis.setex(cacheKey, 3600, JSON.stringify(config));
  } catch (err) {
    logger.warn(`[AutoMod Cache] Lỗi ghi Redis cho group ${groupId}:`, err);
  }

  return config;
}

export const automodService = {
  moderateMessage: async (input: ModerateMessageInput): Promise<ModerateMessageResult> => {
    // 1. Chỉ kiểm duyệt tin nhắn dạng text hoặc caption của media (nếu có content dạng chữ)
    if (!input.content || !input.content.trim()) {
      return { allowed: true, content: input.content };
    }

    // Chỉ áp dụng cho tin nhắn chữ hoặc media có text caption
    const isTextLike = ['text', 'image', 'video', 'file', 'audio'].includes(input.messageType);
    if (!isTextLike) {
      return { allowed: true, content: input.content };
    }

    // 2. Tải cấu hình kiểm duyệt
    const config = await getAutomodConfigWithCache(input.groupId);

    logger.info(
      `[AutoMod Debug] Group ${input.groupId}: enabled=${config?.autoModerateEnabled}, action=${config?.autoModerateAction}, keywords=[${config?.blacklistedKeywords?.join(', ')}]`,
    );

    if (!config || !config.autoModerateEnabled || !config.blacklistedKeywords.length) {
      return { allowed: true, content: input.content };
    }

    // Chuẩn hóa Unicode về NFC để đồng bộ bộ gõ tiếng Việt (tránh lệch NFC/NFD giữa iOS/Windows)
    const normalizedContent = input.content.normalize('NFC');
    const normalizedKws = config.blacklistedKeywords.map((k) => k.trim().normalize('NFC'));

    // 3. Xây dựng Regex Unicode ranh giới từ (Unicode word boundary) cực kỳ an toàn
    const escapedKws = normalizedKws.map(escapeRegex);

    // Sử dụng Lookbehind (?<![\p{L}\p{N}]) và Lookahead (?![\p{L}\p{N}])
    // để Enforce ranh giới từ Unicode, tránh False Positive (như sex trong Sussex)
    const regex = new RegExp(
      `(?<![\\p{L}\\p{N}])(${escapedKws.join('|')})(?![\\p{L}\\p{N}])`,
      'giu',
    );

    logger.info(
      `[AutoMod Debug] So khớp content: "${normalizedContent}" với regex: ${regex.toString()}`,
    );

    if (config.autoModerateAction === 'block') {
      const hasViolation = regex.test(normalizedContent);
      logger.info(`[AutoMod Debug] Kết quả chế độ BLOCK: hasViolation=${hasViolation}`);
      if (hasViolation) {
        return { allowed: false, content: input.content, action: 'block' };
      }
    } else {
      // Censor Mode: Thay thế các từ cấm bằng dấu *
      let matchedCount = 0;
      const censored = normalizedContent.replace(regex, (match: string) => {
        matchedCount++;
        return '*'.repeat(match.length);
      });

      logger.info(
        `[AutoMod Debug] Kết quả chế độ CENSOR: matchedCount=${matchedCount}, censored="${censored}"`,
      );

      return {
        allowed: true,
        content: censored,
        action: matchedCount > 0 ? 'censor' : undefined,
        matchedKeywords: matchedCount > 0 ? ['***'] : [],
      };
    }

    return { allowed: true, content: input.content };
  },
};
