/**
 * Extract #hashtag and @mention tokens from caption text.
 *
 * Reels captions are plain UTF-8 strings (not Tiptap JSON like posts).
 * Returns deduplicated, lowercased arrays of tag names without prefix.
 */

const HASHTAG_RE = /(?:^|\s)#([\p{L}\p{N}_]+)/gu;
const MENTION_RE = /(?:^|\s)@([\p{L}\p{N}_.]+)/gu;

export const extractHashtagsFromText = (text: string): string[] => {
  if (!text) return [];
  const tags = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = HASHTAG_RE.exec(text)) !== null) {
    tags.add(match[1].toLowerCase());
  }
  return Array.from(tags);
};

export const extractMentionsFromText = (text: string): string[] => {
  if (!text) return [];
  const mentions = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = MENTION_RE.exec(text)) !== null) {
    mentions.add(match[1].toLowerCase());
  }
  return Array.from(mentions);
};
