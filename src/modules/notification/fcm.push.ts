import { createSign } from 'node:crypto';
import { env } from '@/config/env.js';
import { logger } from '@/shared/utils/logger.js';

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

interface GoogleAccessTokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface CachedAccessToken {
  token: string;
  expiresAtMs: number;
}

export interface FcmDataOnlyMessage {
  message: {
    token: string;
    data: Record<string, string>;
    android: {
      priority: 'HIGH';
      ttl: '30s';
    };
  };
}

let cachedAccessToken: CachedAccessToken | null = null;

function base64Url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function firebasePrivateKey(): string {
  return env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n').trim();
}

export function isFcmPushConfigured(): boolean {
  return Boolean(
    env.FIREBASE_PROJECT_ID.trim() && env.FIREBASE_CLIENT_EMAIL.trim() && firebasePrivateKey(),
  );
}

function buildServiceAccountJwt(nowSec: number): string {
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(
    JSON.stringify({
      iss: env.FIREBASE_CLIENT_EMAIL,
      scope: FCM_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: nowSec,
      exp: nowSec + 3600,
    }),
  );
  const unsigned = `${header}.${claims}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(firebasePrivateKey());
  return `${unsigned}.${base64Url(signature)}`;
}

async function getGoogleAccessToken(): Promise<string | null> {
  if (!isFcmPushConfigured()) return null;
  const nowMs = Date.now();
  if (cachedAccessToken && cachedAccessToken.expiresAtMs - nowMs > 60_000) {
    return cachedAccessToken.token;
  }

  const assertion = buildServiceAccountJwt(Math.floor(nowMs / 1000));
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await res.json()) as GoogleAccessTokenResponse;
  if (!res.ok || !json.access_token) {
    logger.warn(`[FCM] OAuth token request failed: ${res.status} ${JSON.stringify(json)}`);
    return null;
  }

  cachedAccessToken = {
    token: json.access_token,
    expiresAtMs: nowMs + Math.max(60, json.expires_in ?? 3600) * 1000,
  };
  return json.access_token;
}

export function toFcmStringData(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value == null) continue;
    if (typeof value === 'string') out[key] = value;
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = String(value);
    else out[key] = JSON.stringify(value);
  }
  return out;
}

export function buildFcmDataOnlyMessage(
  token: string,
  data: Record<string, unknown>,
): FcmDataOnlyMessage {
  return {
    message: {
      token,
      data: toFcmStringData(data),
      android: {
        priority: 'HIGH',
        ttl: '30s',
      },
    },
  };
}

export async function sendFcmDataOnlyToTokens(
  tokens: string[],
  data: Record<string, unknown>,
): Promise<void> {
  const uniqueTokens = [...new Set(tokens.map((t) => t.trim()).filter(Boolean))];
  if (uniqueTokens.length === 0) return;

  const accessToken = await getGoogleAccessToken();
  if (!accessToken) {
    logger.warn('[FCM] Push skipped because Firebase service account is not configured.');
    return;
  }

  const endpoint = `https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`;
  const stringData = toFcmStringData(data);

  await Promise.all(
    uniqueTokens.map(async (token) => {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildFcmDataOnlyMessage(token, stringData)),
      });
      if (!res.ok) {
        const body = await res.text();
        logger.warn(`[FCM] Send failed: ${res.status} ${body}`);
      }
    }),
  );
}
