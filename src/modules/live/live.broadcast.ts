import { getIO } from '@/socket/index.js';

export const emitToLiveRoom = (sessionId: string, event: string, payload: unknown): void => {
  try {
    getIO().to(`live:${sessionId}`).emit(event, payload);
  } catch {
    /* socket chưa init khi test script */
  }
};
