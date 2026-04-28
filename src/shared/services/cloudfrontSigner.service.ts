import { getSignedUrl } from '@aws-sdk/cloudfront-signer';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { env } from '@/config/env.js';
import { CLOUDFRONT_PRIVATE_URL, CLOUDFRONT_PUBLIC_URL } from '@/config/s3.js';

function trimSlashes(input: string): string {
  return input.replace(/^\/+|\/+$/g, '');
}

function normalizePrivateKey(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.replace(/\\n/g, '\n');
}

function resolvePrivateKeyInput(raw: string): string {
  const normalized = normalizePrivateKey(raw);
  if (!normalized) return '';

  // Inline PEM (single-line with \n or multiline) is supported directly.
  if (normalized.includes('BEGIN PRIVATE KEY')) {
    return normalized;
  }

  // Also support passing a file path in env.
  const pathCandidate = normalized;
  const filePath = isAbsolute(pathCandidate)
    ? pathCandidate
    : resolve(process.cwd(), pathCandidate);
  if (!existsSync(filePath)) {
    return normalized;
  }

  try {
    const fromFile = readFileSync(filePath, 'utf8');
    return normalizePrivateKey(fromFile);
  } catch {
    return normalized;
  }
}

export function buildPublicCdnUrl(key: string): string {
  const base = CLOUDFRONT_PUBLIC_URL || '';
  const cleanKey = trimSlashes(key);
  if (!base || !cleanKey) return '';
  return `${base}/${cleanKey}`;
}

export function buildPrivateCdnUrl(key: string): string {
  const base = CLOUDFRONT_PRIVATE_URL || '';
  const cleanKey = trimSlashes(key);
  if (!base || !cleanKey) return '';
  return `${base}/${cleanKey}`;
}

export function signPrivateCdnUrl(
  key: string,
  expiresInSeconds = env.CLOUDFRONT_PRIVATE_URL_TTL_SECONDS,
): string {
  const rawUrl = buildPrivateCdnUrl(key);
  if (!rawUrl) return '';

  const keyPairId = env.CLOUDFRONT_SIGNING_KEY_PAIR_ID.trim();
  const privateKey = resolvePrivateKeyInput(env.CLOUDFRONT_SIGNING_PRIVATE_KEY);

  if (!keyPairId || !privateKey) {
    return rawUrl;
  }

  const expiresAtMs = Date.now() + Math.max(1, expiresInSeconds) * 1000;
  return getSignedUrl({
    url: rawUrl,
    keyPairId,
    privateKey,
    dateLessThan: new Date(expiresAtMs).toISOString(),
  });
}
