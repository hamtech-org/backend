/* eslint-disable no-console -- CLI migration script */
import {
  DynamoDBClient,
  CreateTableCommand,
  ListTablesCommand,
  ScanCommand,
  PutItemCommand,
  type DynamoDBClientConfig,
} from '@aws-sdk/client-dynamodb';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

dotenv.config();

const REGION = process.env.AWS_REGION ?? 'us-east-1';
const ENDPOINT = process.env.DYNAMODB_ENDPOINT?.trim() ?? 'http://localhost:8000';
const PREFIX = process.env.DYNAMODB_TABLE_PREFIX ?? 'Zalogram_';

const clientConfig: DynamoDBClientConfig = {
  region: REGION,
};

if (ENDPOINT) {
  clientConfig.endpoint = ENDPOINT;
}

if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  clientConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}

const client = new DynamoDBClient(clientConfig);

function tableName(name: string): string {
  return `${PREFIX}${name}`;
}

const MIGRATIONS_TABLE = tableName('Migrations');

async function ensureMigrationTable(): Promise<void> {
  const { TableNames: existing = [] } = await client.send(new ListTablesCommand({}));

  if (!existing.includes(MIGRATIONS_TABLE)) {
    console.log(`[Init] Đang tạo bảng ${MIGRATIONS_TABLE}...`);
    await client.send(
      new CreateTableCommand({
        TableName: MIGRATIONS_TABLE,
        KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
        BillingMode: 'PAY_PER_REQUEST',
      }),
    );
    console.log(`[Init] Tạo thành công bảng ${MIGRATIONS_TABLE}.`);
  }
}

async function getExecutedMigrations(): Promise<string[]> {
  try {
    const result = await client.send(
      new ScanCommand({
        TableName: MIGRATIONS_TABLE,
        ProjectionExpression: 'id',
      }),
    );
    return (result.Items ?? []).map((item) => item.id.S as string);
  } catch (error) {
    console.error(`[Error] Không thể đọc bảng ${MIGRATIONS_TABLE}`, error);
    return [];
  }
}

async function runMigrations(): Promise<void> {
  console.log(`\n== Zalogram DynamoDB Migrations ==`);
  console.log(`Endpoint : ${ENDPOINT || '(AWS managed endpoint)'}`);
  console.log(`Prefix   : ${PREFIX}\n`);

  await ensureMigrationTable();

  const executed = await getExecutedMigrations();
  const migrationsDir = path.join(__dirname, 'migrations');

  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
    console.log(`[Info] Đã tạo thư mục ${migrationsDir}`);
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.ts') || f.endsWith('.js'))
    .sort(); // Sắp xếp theo tên (chronological nếu tên có timestamp)

  let count = 0;

  for (const file of files) {
    if (executed.includes(file)) {
      continue;
    }

    console.log(`[Migrate] Đang chạy: ${file}...`);
    try {
      const migrationPath = path.join(migrationsDir, file);
      const moduleUrl = pathToFileURL(migrationPath).href;

      const migration = await import(moduleUrl);

      if (typeof migration.up !== 'function') {
        throw new Error(`File ${file} không có hàm export 'up' hợp lệ.`);
      }

      await migration.up(client, PREFIX);

      await client.send(
        new PutItemCommand({
          TableName: MIGRATIONS_TABLE,
          Item: {
            id: { S: file },
            executedAt: { S: new Date().toISOString() },
          },
        }),
      );
      console.log(`[Migrate] Hoàn tất: ${file}`);
      count++;
    } catch (err) {
      console.error(`[Error] Migration ${file} thất bại! Dừng quá trình.`);
      console.error(err);
      process.exit(1);
    }
  }

  if (count === 0) {
    console.log(`[Info] Không có migration mới nào cần chạy.`);
  } else {
    console.log(`\n[Info] Đã chạy thành công ${count} migrations.`);
  }
}

runMigrations().catch((err) => {
  console.error('Lỗi chạy migration:', err);
  process.exit(1);
});
