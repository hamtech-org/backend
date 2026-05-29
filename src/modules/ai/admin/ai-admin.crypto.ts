import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const PREFIX = 'enc:v1:';

function getKey(): Buffer {
  const raw = process.env.AI_CONFIG_ENCRYPTION_KEY || process.env.JWT_ACCESS_SECRET || 'dev-key';
  return createHash('sha256').update(raw).digest();
}

export function encryptSecret(value: string): string {
  const text = value.trim();
  if (!text) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${Buffer.concat([iv, tag, encrypted]).toString('base64')}`;
}

export function decryptSecret(value: string | undefined): string {
  if (!value) return '';
  if (!value.startsWith(PREFIX)) return value;
  const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
