import { BatchGetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '@/config/database.js';
import { env } from '@/config/env.js';
import type { IConversation } from '@/modules/chat/shared/chat.types.js';
import type { IMedia, MediaType } from '@/modules/media/media.types.js';
import { extractMediaIdFromUrl } from '@/modules/media/mediaUrl.util.js';
import { userRepository } from '@/modules/user/user.repository.js';
import type {
  IAdminResourceSummary,
  IResourceBreakdownCell,
  IResourceBySourceRow,
  IResourceByTypeRow,
  IResourceTopUploader,
  ResourceSource,
} from './admin.resources.types.js';

const MEDIA_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Media`;
const MESSAGES_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Messages`;
const POSTS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Posts`;
const REELS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Reels`;
const USERS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Users`;
const CONVERSATIONS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Conversations`;

const CACHE_TTL_MS = 5 * 60 * 1000;
const TOP_UPLOADERS_LIMIT = 10;

const SOURCE_PRIORITY: Record<ResourceSource, number> = {
  other: 0,
  avatar: 1,
  chat_direct: 2,
  chat_group: 2,
  reel: 3,
  post: 4,
};

const ALL_SOURCES: ResourceSource[] = [
  'chat_direct',
  'chat_group',
  'post',
  'reel',
  'avatar',
  'other',
];

const ALL_TYPES: MediaType[] = ['image', 'video', 'audio', 'file'];

type CacheEntry = { value: IAdminResourceSummary; expiresAt: number };
const summaryCache = new Map<string, CacheEntry>();

async function scanTable<T extends Record<string, unknown>>(
  tableName: string,
  options?: {
    filterExpression?: string;
    expressionAttributeNames?: Record<string, string>;
    expressionAttributeValues?: Record<string, unknown>;
    projectionExpression?: string;
  },
): Promise<T[]> {
  const items: T[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const result = await dynamoClient.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: exclusiveStartKey,
        ...(options?.filterExpression
          ? {
              FilterExpression: options.filterExpression,
              ExpressionAttributeNames: options.expressionAttributeNames,
              ExpressionAttributeValues: options.expressionAttributeValues,
            }
          : {}),
        ...(options?.projectionExpression
          ? { ProjectionExpression: options.projectionExpression }
          : {}),
      }),
    );
    items.push(...((result.Items as T[]) ?? []));
    exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  return items;
}

function assignSource(
  map: Map<string, ResourceSource>,
  mediaId: string,
  source: ResourceSource,
): void {
  const current = map.get(mediaId);
  if (!current || SOURCE_PRIORITY[source] > SOURCE_PRIORITY[current]) {
    map.set(mediaId, source);
  }
}

function collectUrls(urls: (string | null | undefined)[]): string[] {
  return urls.filter((u): u is string => typeof u === 'string' && u.trim().length > 0);
}

async function buildMediaIdSourceMap(): Promise<Map<string, ResourceSource>> {
  const sourceByMediaId = new Map<string, ResourceSource>();

  const messageRows = await scanTable<{
    conversationId?: string;
    mediaUrl?: string | null;
    thumbnailUrl?: string | null;
    PK?: string;
  }>(MESSAGES_TABLE, {
    filterExpression: 'begins_with(SK, :msgPrefix)',
    expressionAttributeValues: { ':msgPrefix': 'MSG#' },
    projectionExpression: 'conversationId, mediaUrl, thumbnailUrl, PK',
  });

  const convIds = new Set<string>();
  for (const row of messageRows) {
    const convId =
      row.conversationId ??
      (typeof row.PK === 'string' && row.PK.startsWith('CONV#')
        ? row.PK.replace('CONV#', '')
        : null);
    if (convId) convIds.add(convId);
  }

  const convTypeById = new Map<string, 'direct' | 'group'>();
  const convIdList = [...convIds];
  for (let i = 0; i < convIdList.length; i += 100) {
    const chunk = convIdList.slice(i, i + 100);
    const result = await dynamoClient.send(
      new BatchGetCommand({
        RequestItems: {
          [CONVERSATIONS_TABLE]: {
            Keys: chunk.map((id) => ({ PK: `CONV#${id}`, SK: 'META' })),
          },
        },
      }),
    );
    const convs = (result.Responses?.[CONVERSATIONS_TABLE] as IConversation[]) ?? [];
    for (const c of convs) {
      if (c?.conversationId && c.type) {
        convTypeById.set(c.conversationId, c.type);
      }
    }
  }

  for (const row of messageRows) {
    const convId =
      row.conversationId ??
      (typeof row.PK === 'string' && row.PK.startsWith('CONV#')
        ? row.PK.replace('CONV#', '')
        : null);
    if (!convId) continue;

    const convType = convTypeById.get(convId);
    const chatSource: ResourceSource = convType === 'group' ? 'chat_group' : 'chat_direct';

    for (const url of collectUrls([row.mediaUrl, row.thumbnailUrl])) {
      const id = extractMediaIdFromUrl(url);
      if (id) assignSource(sourceByMediaId, id, chatSource);
    }
  }

  const posts = await scanTable<{ mediaUrls?: string[] }>(POSTS_TABLE, {
    filterExpression: 'SK = :meta',
    expressionAttributeValues: { ':meta': 'META' },
    projectionExpression: 'mediaUrls',
  });
  for (const post of posts) {
    const urls = Array.isArray(post.mediaUrls) ? post.mediaUrls : [];
    for (const url of urls) {
      const id = extractMediaIdFromUrl(url);
      if (id) assignSource(sourceByMediaId, id, 'post');
    }
  }

  const reels = await scanTable<{ videoUrl?: string; thumbnailUrl?: string | null }>(REELS_TABLE, {
    filterExpression: 'SK = :meta',
    expressionAttributeValues: { ':meta': 'META' },
    projectionExpression: 'videoUrl, thumbnailUrl',
  });
  for (const reel of reels) {
    for (const url of collectUrls([reel.videoUrl, reel.thumbnailUrl])) {
      const id = extractMediaIdFromUrl(url);
      if (id) assignSource(sourceByMediaId, id, 'reel');
    }
  }

  const users = await scanTable<{ avatar?: string | null }>(USERS_TABLE, {
    filterExpression: 'SK = :profile',
    expressionAttributeValues: { ':profile': 'PROFILE' },
    projectionExpression: 'avatar',
  });
  for (const user of users) {
    const id = extractMediaIdFromUrl(user.avatar);
    if (id) assignSource(sourceByMediaId, id, 'avatar');
  }

  return sourceByMediaId;
}

function buildMatrix(
  mediaItems: IMedia[],
  sourceByMediaId: Map<string, ResourceSource>,
): IResourceBreakdownCell[] {
  const cellMap = new Map<string, IResourceBreakdownCell>();

  for (const media of mediaItems) {
    const source = sourceByMediaId.get(media.mediaId) ?? 'other';
    const type = (media.type ?? 'file') as MediaType;
    const key = `${source}:${type}`;
    const existing = cellMap.get(key);
    const size = typeof media.size === 'number' && media.size > 0 ? media.size : 0;

    if (existing) {
      existing.bytes += size;
      existing.count += 1;
    } else {
      cellMap.set(key, { source, type, bytes: size, count: 1 });
    }
  }

  return [...cellMap.values()];
}

function aggregateBySource(matrix: IResourceBreakdownCell[]): IResourceBySourceRow[] {
  const totals = new Map<ResourceSource, { bytes: number; count: number }>();
  let totalBytes = 0;

  for (const cell of matrix) {
    totalBytes += cell.bytes;
    const row = totals.get(cell.source) ?? { bytes: 0, count: 0 };
    row.bytes += cell.bytes;
    row.count += cell.count;
    totals.set(cell.source, row);
  }

  return [...totals.entries()]
    .map(([source, v]) => ({
      source,
      bytes: v.bytes,
      count: v.count,
      percent: totalBytes > 0 ? Math.round((v.bytes / totalBytes) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.bytes - a.bytes);
}

function aggregateByType(matrix: IResourceBreakdownCell[]): IResourceByTypeRow[] {
  const totals = new Map<MediaType, { bytes: number; count: number }>();
  let totalBytes = 0;

  for (const cell of matrix) {
    totalBytes += cell.bytes;
    const row = totals.get(cell.type) ?? { bytes: 0, count: 0 };
    row.bytes += cell.bytes;
    row.count += cell.count;
    totals.set(cell.type, row);
  }

  return [...totals.entries()]
    .map(([type, v]) => ({
      type,
      bytes: v.bytes,
      count: v.count,
      percent: totalBytes > 0 ? Math.round((v.bytes / totalBytes) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.bytes - a.bytes);
}

function buildTopUploaders(mediaItems: IMedia[]): IResourceTopUploader[] {
  const byUser = new Map<string, { bytes: number; count: number }>();
  for (const m of mediaItems) {
    const uid = m.uploaderId;
    if (!uid) continue;
    const row = byUser.get(uid) ?? { bytes: 0, count: 0 };
    row.bytes += m.size ?? 0;
    row.count += 1;
    byUser.set(uid, row);
  }

  return [...byUser.entries()]
    .map(([userId, v]) => ({ userId, displayName: userId, ...v }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, TOP_UPLOADERS_LIMIT);
}

async function computeSummary(): Promise<IAdminResourceSummary> {
  const computedAt = new Date().toISOString();
  const cachedUntil = new Date(Date.now() + CACHE_TTL_MS).toISOString();

  const [mediaItems, sourceByMediaId] = await Promise.all([
    scanTable<IMedia & Record<string, unknown>>(MEDIA_TABLE, {
      filterExpression: 'SK = :meta',
      expressionAttributeValues: { ':meta': 'META' },
    }),
    buildMediaIdSourceMap(),
  ]);

  const matrix = buildMatrix(mediaItems, sourceByMediaId);
  const totalBytes = matrix.reduce((s, c) => s + c.bytes, 0);
  const totalFiles = mediaItems.length;

  let topUploaders = buildTopUploaders(mediaItems);
  if (topUploaders.length > 0) {
    const users = await userRepository.findByIds(topUploaders.map((u) => u.userId));
    const nameMap = new Map(users.map((u) => [u.userId, u.displayName]));
    topUploaders = topUploaders.map((u) => ({
      ...u,
      displayName: nameMap.get(u.userId) ?? u.userId,
    }));
  }

  return {
    totalBytes,
    totalFiles,
    computedAt,
    cachedUntil,
    matrix,
    bySource: aggregateBySource(matrix),
    byType: aggregateByType(matrix),
    topUploaders,
  };
}

export const adminResourcesService = {
  getSummary: async (forceRefresh = false): Promise<IAdminResourceSummary> => {
    const now = Date.now();
    const cached = summaryCache.get('summary');
    if (!forceRefresh && cached && cached.expiresAt > now) {
      return cached.value;
    }

    const value = await computeSummary();
    summaryCache.set('summary', { value, expiresAt: now + CACHE_TTL_MS });
    return value;
  },

  /** Exported for tests / charts empty state helpers */
  ALL_SOURCES,
  ALL_TYPES,
};
