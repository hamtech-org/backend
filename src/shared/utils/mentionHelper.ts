export interface MentionToken {
  type: 'text' | 'mention';
  value: string;
  userId?: string;
}

/**
 * Loại bỏ các ký tự đặc biệt [ ] ( ) để tránh làm hỏng cú pháp markdown của tag nhắc tên.
 */
export function escapeMentionLabel(displayName: string): string {
  if (!displayName) return '';
  return displayName.replace(/[[\]()]/g, '').trim();
}

/**
 * Phân tích cú pháp chuỗi chứa tag nhắc tên markdown thành các token văn bản và token nhắc tên.
 * Phục vụ cho việc hiển thị định dạng tin nhắn đẹp mắt trên Web & Mobile mà không dùng innerHTML.
 */
export function parseMentionTokens(content: string): MentionToken[] {
  if (!content) return [];
  const regex = /@\[\s*(.*?)\s*\]\((?:mention|metion|m[a-z]+):([a-zA-Z0-9-]+|all)\)/g;
  const tokens: MentionToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const [_, displayName, userId] = match;
    const matchIndex = match.index;

    // Chèn đoạn text thường phía trước tag (nếu có)
    if (matchIndex > lastIndex) {
      tokens.push({
        type: 'text',
        value: content.substring(lastIndex, matchIndex),
      });
    }

    // Chèn tag nhắc tên
    tokens.push({
      type: 'mention',
      value: displayName.trim(),
      userId: userId,
    });

    lastIndex = regex.lastIndex;
  }

  // Chèn đoạn text thường còn lại ở cuối (nếu có)
  if (lastIndex < content.length) {
    tokens.push({
      type: 'text',
      value: content.substring(lastIndex),
    });
  }

  return tokens;
}

/**
 * Chuyển đổi markdown mention thành chữ thô dạng @Tên hiển thị.
 * Phục vụ cho việc lưu trữ preview tin nhắn cuối (lastMessage) và push notification.
 */
export function stripMentionMarkdown(content: string): string {
  if (!content) return '';
  return content.replace(
    /@\[\s*(.*?)\s*\]\((?:mention|metion|m[a-z]+):([a-zA-Z0-9-]+|all)\)/g,
    '@$1',
  );
}
