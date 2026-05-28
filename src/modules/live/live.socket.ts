import { Server, Socket } from 'socket.io';
import { userRepository } from '@/modules/user/user.repository.js';
import { emitToLiveRoom } from '@/modules/live/live.broadcast.js';
import { liveRepository } from '@/modules/live/live.repository.js';
import {
  addHostPublisher,
  addLiveViewer,
  getLiveViewerUserIds,
  isHostPublishing,
  isHostPublishingElsewhere,
  removeHostPublisher,
  removeLiveViewer,
} from '@/modules/live/live.presence.js';

type LiveSocketData = {
  userId: string;
  displayName?: string;
  liveSessionIds?: Set<string>;
  hostPublishingSessionIds?: Set<string>;
};

async function broadcastViewersUpdated(sessionId: string): Promise<void> {
  const meta = await liveRepository.findMetaById(sessionId);
  if (!meta || meta.status !== 'live') return;

  const hostSet = new Set([meta.hostUserId]);
  const allViewerIds = getLiveViewerUserIds(sessionId);
  const viewerUserIds = allViewerIds.filter((id) => !hostSet.has(id));
  const users = await userRepository.findByIds(viewerUserIds);
  const userMap = new Map(users.map((u) => [u.userId, u]));

  emitToLiveRoom(sessionId, 'live:viewers-updated', {
    sessionId,
    viewerCount: viewerUserIds.length,
    viewerUserIds,
    viewers: viewerUserIds.map((uid) => ({
      userId: uid,
      displayName: userMap.get(uid)?.displayName ?? uid.slice(0, 8),
      avatar: userMap.get(uid)?.avatar ?? null,
    })),
  });
}

function trackSession(socket: Socket, sessionId: string): void {
  const data = socket.data as LiveSocketData;
  if (!data.liveSessionIds) data.liveSessionIds = new Set();
  data.liveSessionIds.add(sessionId);
}

function untrackSession(socket: Socket, sessionId: string): void {
  const data = socket.data as LiveSocketData;
  data.liveSessionIds?.delete(sessionId);
}

function emitMyHostPublishing(
  io: Server,
  userId: string,
  sessionId: string,
  active: boolean,
): void {
  io.to(`user:${userId}`).emit('live:my-host-publishing', { sessionId, active });
}

export const registerLiveHandlers = (io: Server, socket: Socket): void => {
  const data = socket.data as LiveSocketData;
  const userId = data.userId;
  const displayName = data.displayName ?? userId;

  socket.on('live:join', (payload: { sessionId: string }) => {
    const sid = payload?.sessionId;
    if (!sid || typeof sid !== 'string') return;
    socket.join(`live:${sid}`);
    addLiveViewer(sid, userId, socket.id);
    trackSession(socket, sid);
    void broadcastViewersUpdated(sid);
  });

  socket.on('live:leave', (payload: { sessionId: string }) => {
    const sid = payload?.sessionId;
    if (!sid || typeof sid !== 'string') return;
    socket.leave(`live:${sid}`);
    removeLiveViewer(sid, userId, socket.id);
    untrackSession(socket, sid);
    void broadcastViewersUpdated(sid);
  });

  socket.on('live:host-publish-start', async (payload: { sessionId: string }) => {
    const sid = payload?.sessionId;
    if (!sid || typeof sid !== 'string') return;
    const meta = await liveRepository.findMetaById(sid);
    if (!meta || meta.status !== 'live' || meta.hostUserId !== userId) return;
    addHostPublisher(sid, userId, socket.id);
    if (!data.hostPublishingSessionIds) data.hostPublishingSessionIds = new Set();
    data.hostPublishingSessionIds.add(sid);
    emitMyHostPublishing(io, userId, sid, true);
  });

  socket.on('live:host-publish-stop', (payload: { sessionId: string }) => {
    const sid = payload?.sessionId;
    if (!sid || typeof sid !== 'string') return;
    removeHostPublisher(sid, userId, socket.id);
    data.hostPublishingSessionIds?.delete(sid);
    const still = isHostPublishing(sid, userId);
    emitMyHostPublishing(io, userId, sid, still);
  });

  socket.on(
    'live:host-publish-query',
    async (
      payload: { sessionId: string },
      cb?: (res: { publishingElsewhere: boolean }) => void,
    ) => {
      const sid = payload?.sessionId;
      if (!sid || typeof sid !== 'string' || typeof cb !== 'function') return;
      const meta = await liveRepository.findMetaById(sid);
      if (!meta || meta.status !== 'live' || meta.hostUserId !== userId) {
        cb({ publishingElsewhere: false });
        return;
      }
      cb({
        publishingElsewhere: isHostPublishingElsewhere(sid, userId, socket.id),
      });
    },
  );

  socket.on('live:chat-message', (payload: { sessionId: string; text: string }) => {
    const sid = payload?.sessionId;
    const text = payload?.text?.trim();
    if (!sid || !text || typeof sid !== 'string') return;
    if (text.length > 2000) return;
    emitToLiveRoom(sid, 'live:chat-message', {
      sessionId: sid,
      userId,
      displayName,
      text,
      sentAt: new Date().toISOString(),
    });
  });

  socket.on('disconnect', () => {
    const sessions = [...(data.liveSessionIds ?? [])];
    for (const sid of sessions) {
      removeLiveViewer(sid, userId, socket.id);
      void broadcastViewersUpdated(sid);
    }
    data.liveSessionIds?.clear();

    const hostSessions = [...(data.hostPublishingSessionIds ?? [])];
    for (const sessionId of hostSessions) {
      removeHostPublisher(sessionId, userId, socket.id);
      const still = isHostPublishing(sessionId, userId);
      emitMyHostPublishing(io, userId, sessionId, still);
    }
    data.hostPublishingSessionIds?.clear();
  });
};
