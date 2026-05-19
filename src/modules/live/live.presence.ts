/** In-memory viewer presence per live session (socket-based). */

type SessionPresence = Map<string, Set<string>>;

const bySession = new Map<string, SessionPresence>();

function ensureSession(sessionId: string): SessionPresence {
  let map = bySession.get(sessionId);
  if (!map) {
    map = new Map();
    bySession.set(sessionId, map);
  }
  return map;
}

export function addLiveViewer(sessionId: string, userId: string, socketId: string): void {
  const map = ensureSession(sessionId);
  let sockets = map.get(userId);
  if (!sockets) {
    sockets = new Set();
    map.set(userId, sockets);
  }
  sockets.add(socketId);
}

export function removeLiveViewer(sessionId: string, userId: string, socketId: string): void {
  const map = bySession.get(sessionId);
  if (!map) return;
  const sockets = map.get(userId);
  if (!sockets) return;
  sockets.delete(socketId);
  if (sockets.size === 0) map.delete(userId);
  if (map.size === 0) bySession.delete(sessionId);
}

export function getLiveViewerUserIds(sessionId: string): string[] {
  const map = bySession.get(sessionId);
  if (!map) return [];
  return [...map.keys()];
}

/** Host đang publish (studio) — theo session + user + socket. */
const hostPublishers = new Map<string, Map<string, Set<string>>>();

function ensureHostSession(sessionId: string): Map<string, Set<string>> {
  let byUser = hostPublishers.get(sessionId);
  if (!byUser) {
    byUser = new Map();
    hostPublishers.set(sessionId, byUser);
  }
  return byUser;
}

export function addHostPublisher(sessionId: string, userId: string, socketId: string): void {
  const byUser = ensureHostSession(sessionId);
  let sockets = byUser.get(userId);
  if (!sockets) {
    sockets = new Set();
    byUser.set(userId, sockets);
  }
  sockets.add(socketId);
}

export function removeHostPublisher(sessionId: string, userId: string, socketId: string): void {
  const byUser = hostPublishers.get(sessionId);
  if (!byUser) return;
  const sockets = byUser.get(userId);
  if (!sockets) return;
  sockets.delete(socketId);
  if (sockets.size === 0) byUser.delete(userId);
  if (byUser.size === 0) hostPublishers.delete(sessionId);
}

export function getHostPublisherSocketIds(sessionId: string, userId: string): string[] {
  const byUser = hostPublishers.get(sessionId);
  const sockets = byUser?.get(userId);
  if (!sockets) return [];
  return [...sockets];
}

export function isHostPublishing(sessionId: string, userId: string): boolean {
  return getHostPublisherSocketIds(sessionId, userId).length > 0;
}

export function isHostPublishingElsewhere(
  sessionId: string,
  userId: string,
  currentSocketId: string,
): boolean {
  const ids = getHostPublisherSocketIds(sessionId, userId);
  if (ids.length === 0) return false;
  return ids.some((id) => id !== currentSocketId);
}
