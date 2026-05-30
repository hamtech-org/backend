import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

interface IAiUnreadSummaryLogEntry {
  conversationId: string;
  userId: string;
  recapSessionId?: string;
  recapSessionStatus?: string;
  unreadMessageCount: number;
  messagesSentToAi: number;
  unreadTranscript: string;
}

const unreadSummaryLogFile = join(process.cwd(), 'logs', 'ai-group-unread-transcript.log');

export const writeAiUnreadSummaryTranscriptLog = async (
  entry: IAiUnreadSummaryLogEntry,
): Promise<void> => {
  const lines = [
    `===== ${new Date().toISOString()} =====`,
    `conversationId: ${entry.conversationId}`,
    `userId: ${entry.userId}`,
    `recapSessionId: ${entry.recapSessionId ?? ''}`,
    `recapSessionStatus: ${entry.recapSessionStatus ?? ''}`,
    `unreadMessageCount: ${entry.unreadMessageCount}`,
    `messagesSentToAi: ${entry.messagesSentToAi}`,
    'Transcript tin nhan chua doc gui cho AI:',
    entry.unreadTranscript,
    '',
  ];

  try {
    await mkdir(dirname(unreadSummaryLogFile), { recursive: true });
    await appendFile(unreadSummaryLogFile, `${lines.join('\n')}\n`, 'utf8');
  } catch {
    // Debug logging must not interrupt the summary flow.
  }
};
