/* eslint-disable no-console -- CLI seed script */
/**
 * insert-data.ts — Đọc tất cả file JSON trong folder data/ và ghi vào DynamoDB.
 *
 * Quy tắc:
 *  - Tên file (PascalCase, không extension) = tên table (thêm prefix).
 *    Ví dụ: Users.json → Zalogram_Users
 *  - Mỗi file là một JSON array chứa các DynamoDB items (đã có PK, SK, ...).
 *  - Dùng BatchWriteItem (max 25 items/batch) với PutRequest → overwrite.
 *
 * Chạy:
 *   npx tsx scripts/database/insert-data.ts
 *   npx tsx scripts/database/insert-data.ts --file Media
 *   npm run db:seed:admin-demo
 */

import fs from 'node:fs';
import path from 'node:path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import dotenv from 'dotenv';

dotenv.config();

const REGION = process.env.AWS_REGION ?? 'ap-southeast-1';
const ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';
const PREFIX = process.env.DYNAMODB_TABLE_PREFIX ?? 'Zalogram_';

const client = new DynamoDBClient({
  region: REGION,
  endpoint: ENDPOINT,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'local',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local',
  },
});
const db = DynamoDBDocumentClient.from(client);

const DATA_DIR = path.join(__dirname, 'data');
const BATCH_SIZE = 25;

/** --file Media.json hoặc --file=Media — chỉ seed một bảng. */
function parseOnlyTableArg(): string | null {
  const flagIdx = process.argv.indexOf('--file');
  if (flagIdx >= 0) {
    const next = process.argv[flagIdx + 1];
    if (next && !next.startsWith('-')) {
      return path.basename(next, '.json');
    }
  }
  const eq = process.argv.find((a) => a.startsWith('--file='));
  if (eq) {
    const raw = eq.slice('--file='.length).trim();
    return raw ? path.basename(raw, '.json') : null;
  }
  return null;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function writeBatchWithRetry(
  tableName: string,
  items: Record<string, unknown>[],
): Promise<number> {
  const chunks = chunkArray(items, BATCH_SIZE);
  let inserted = 0;

  for (const chunk of chunks) {
    let unprocessed: Record<string, unknown>[] = chunk;

    while (unprocessed.length > 0) {
      const result = await db.send(
        new BatchWriteCommand({
          RequestItems: {
            [tableName]: unprocessed.map((item) => ({
              PutRequest: { Item: item },
            })),
          },
        }),
      );

      const failed = result.UnprocessedItems?.[tableName];
      if (failed && failed.length > 0) {
        unprocessed = failed
          .filter((req) => req.PutRequest?.Item)
          .map((req) => req.PutRequest!.Item as Record<string, unknown>);
        await new Promise((r) => setTimeout(r, 500));
      } else {
        inserted += unprocessed.length;
        unprocessed = [];
      }
    }
  }

  return inserted;
}

async function insertData(): Promise<void> {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║   Zalogram — Insert Seed Data        ║');
  console.log('╚══════════════════════════════════════╝');
  console.log(`Endpoint : ${ENDPOINT}`);
  console.log(`Prefix   : ${PREFIX}`);
  console.log(`Data dir : ${DATA_DIR}`);

  if (!fs.existsSync(DATA_DIR)) {
    console.warn('[warn] Data directory not found. Nothing to seed.');
    return;
  }

  const onlyTable = parseOnlyTableArg();
  if (onlyTable) console.log(`Filter   : chỉ bảng ${onlyTable}`);
  console.log('');
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.json'))
    .filter((f) => !onlyTable || path.basename(f, '.json') === onlyTable)
    .sort();

  if (onlyTable && files.length === 0) {
    console.error(`[err]  Không tìm thấy data/${onlyTable}.json`);
    process.exit(1);
  }

  if (files.length === 0) {
    console.warn('[warn] No .json files found in data/. Nothing to seed.');
    return;
  }

  let totalItems = 0;
  let totalFiles = 0;

  for (const file of files) {
    const tableSuffix = path.basename(file, '.json');
    const tableName = `${PREFIX}${tableSuffix}`;
    const filePath = path.join(DATA_DIR, file);

    const raw = fs.readFileSync(filePath, 'utf-8');
    const items: Record<string, unknown>[] = JSON.parse(raw);

    if (!Array.isArray(items) || items.length === 0) {
      console.log(`[skip] ${tableSuffix} — file rỗng hoặc không hợp lệ`);
      continue;
    }

    try {
      const count = await writeBatchWithRetry(tableName, items);
      console.log(`[ok]   ${tableSuffix}: ${count} items`);
      totalItems += count;
      totalFiles++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[err]  ${tableSuffix}: ${message}`);
    }
  }

  console.log(`\nKết quả: ${totalItems} items đã seed vào ${totalFiles} bảng.\n`);

  console.log('Tài khoản đăng nhập (mật khẩu chung: Test@1234):');
  console.log('──────────────────────────────────────────────');
  console.log('  Alice Nguyễn       │ huycoi210804@gmail.com');
  console.log('  Bob Trần           │ ngonhuthuy1@gmail.com');
  console.log('  Charlie Lê         │ ngonhuthuy1234@gmail.com');
  console.log('  Diana Phạm         │ diana@zalogram.test\n');
}

insertData().catch((err: unknown) => {
  console.error('\n[ERROR] Seed thất bại:', err);
  process.exit(1);
});
