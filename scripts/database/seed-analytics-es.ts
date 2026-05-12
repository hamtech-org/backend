#!/usr/bin/env node

/**
 * Seed sample analytics data directly into Elasticsearch (local/dev).
 *
 * Usage:
 * - npm run es:seed:analytics
 * - npm run es:seed:analytics -- --messages 800 --posts 120 --days 7
 *
 * Notes:
 * - This does NOT touch DynamoDB.
 * - It only indexes into ES indices: messages, posts.
 */

import { randomUUID } from 'crypto';
import { esClient, pingElasticsearch } from '@/config/elasticsearch.js';
import { elasticsearchUtils } from '@/shared/utils/elasticsearch.js';
import { logger } from '@/shared/utils/logger.js';

type Args = {
  messages: number;
  posts: number;
  days: number;
};

function parseArgs(argv: string[]): Args {
  const defaults: Args = { messages: 600, posts: 80, days: 7 };
  const out: Args = { ...defaults };

  for (let i = 0; i < argv.length; i++) {
    const rawKey = argv[i];
    const next = argv[i + 1];
    if (!rawKey) continue;

    const [key, inlineValue] = rawKey.split('=', 2) as [string, string | undefined];

    const toInt = (v: string | undefined): number | null => {
      if (!v) return null;
      const n = Number.parseInt(v, 10);
      return Number.isFinite(n) ? n : null;
    };

    if (key === '--messages') {
      const n = toInt(inlineValue ?? next);
      if (n !== null && n >= 0) out.messages = n;
      if (!inlineValue) i++;
      continue;
    }
    if (key === '--posts') {
      const n = toInt(inlineValue ?? next);
      if (n !== null && n >= 0) out.posts = n;
      if (!inlineValue) i++;
      continue;
    }
    if (key === '--days') {
      const n = toInt(inlineValue ?? next);
      if (n !== null && n > 0) out.days = n;
      if (!inlineValue) i++;
      continue;
    }
  }

  return out;
}

function isoBetween(fromMs: number, toMs: number): string {
  const r = Math.random();
  const t = Math.floor(fromMs + r * (toMs - fromMs));
  return new Date(t).toISOString();
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

async function seed(): Promise<void> {
  const { messages, posts, days } = parseArgs(process.argv.slice(2));

  const ok = await pingElasticsearch();
  if (!ok) {
    throw new Error('Elasticsearch is unavailable. Check env.ELASTICSEARCH_NODE and ES container.');
  }

  await elasticsearchUtils.initializeAllIndices();

  const now = Date.now();
  const fromMs = now - days * 86_400_000;
  const toMs = now;

  const userIds = Array.from({ length: 18 }, () => `seed-user-${randomUUID().slice(0, 8)}`);
  const groupConvIds = Array.from({ length: 7 }, () => `seed-group-${randomUUID().slice(0, 8)}`);
  const directConvIds = Array.from({ length: 11 }, () => `seed-direct-${randomUUID().slice(0, 8)}`);

  const bulkOps: Array<Record<string, unknown>> = [];

  for (let i = 0; i < messages; i++) {
    const isGroup = Math.random() < 0.55;
    const conversationId = isGroup ? pick(groupConvIds) : pick(directConvIds);
    const conversationType = isGroup ? 'group' : 'direct';
    const messageId = `seed-message-${randomUUID()}`;
    const senderId = pick(userIds);
    const createdAt = isoBetween(fromMs, toMs);

    bulkOps.push({ index: { _index: 'messages', _id: messageId } });
    bulkOps.push({
      messageId,
      conversationId,
      senderId,
      conversationType,
      content: `Seed message #${i + 1} (${conversationType})`,
      createdAt,
    });
  }

  const postTypes = ['text', 'image', 'video', 'reel'] as const;
  const visibilities = ['public', 'friends', 'private'] as const;
  const publicationStatuses = ['published'] as const;

  for (let i = 0; i < posts; i++) {
    const postId = `seed-post-${randomUUID()}`;
    const authorId = pick(userIds);
    const createdAt = isoBetween(fromMs, toMs);

    bulkOps.push({ index: { _index: 'posts', _id: postId } });
    bulkOps.push({
      postId,
      authorId,
      content: `Seed post #${i + 1}`,
      type: pick(postTypes),
      visibility: pick(visibilities),
      publicationStatus: pick(publicationStatuses),
      tags: ['seed'],
      categories: ['demo'],
      createdAt,
    });
  }

  if (bulkOps.length === 0) {
    logger.info('No seed ops to run (messages=0 and posts=0).');
    return;
  }

  logger.info(`Seeding ES analytics data: messages=${messages}, posts=${posts}, days=${days}`);

  const res = await esClient.bulk({ refresh: false, operations: bulkOps });
  if (res.errors) {
    const items = res.items ?? [];
    const failed = items
      .map((it) => it.index ?? it.create ?? it.update ?? it.delete)
      .filter((op) => op && typeof op === 'object' && 'error' in op);
    logger.warn(`Bulk completed with errors. Failed ops: ${failed.length}`);
  }

  await esClient.indices.refresh({ index: ['messages', 'posts'] });

  logger.info('Seed completed. You can open Admin Statistics page and use range 7/30 days.');
}

seed().catch((error) => {
  logger.error('Seed analytics ES failed:', error);
  process.exit(1);
});
