/**
 * Script tạo bảng DynamoDB cho local development
 * Chạy: npx tsx scripts/create-tables.ts
 */
import {
  DynamoDBClient,
  CreateTableCommand,
  UpdateTimeToLiveCommand,
  ListTablesCommand,
  type CreateTableCommandInput,
} from '@aws-sdk/client-dynamodb';

const endpoint = process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000';
const region = process.env.AWS_REGION || 'ap-southeast-1';

const client = new DynamoDBClient({
  region,
  endpoint,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'local',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'local',
  },
});

// ──────────────────────────────────────────────
// Table Definitions
// ──────────────────────────────────────────────

const TABLES: CreateTableCommandInput[] = [
  // ─── Zalogram_Users ───
  {
    TableName: 'Zalogram_Users',
    KeySchema: [
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: 'S' },
      { AttributeName: 'SK', AttributeType: 'S' },
      { AttributeName: 'GSI1PK', AttributeType: 'S' },
      { AttributeName: 'GSI1SK', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'GSI-1',
        KeySchema: [
          { AttributeName: 'GSI1PK', KeyType: 'HASH' },
          { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
  },

  // ─── Zalogram_Sessions ───
  {
    TableName: 'Zalogram_Sessions',
    KeySchema: [
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: 'S' },
      { AttributeName: 'SK', AttributeType: 'S' },
      { AttributeName: 'GSI1PK', AttributeType: 'S' },
      { AttributeName: 'GSI1SK', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'GSI-1',
        KeySchema: [
          { AttributeName: 'GSI1PK', KeyType: 'HASH' },
          { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
  },

  // ─── Zalogram_Conversations ───
  {
    TableName: 'Zalogram_Conversations',
    KeySchema: [
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: 'S' },
      { AttributeName: 'SK', AttributeType: 'S' },
      { AttributeName: 'GSI1PK', AttributeType: 'S' },
      { AttributeName: 'GSI1SK', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'GSI-1',
        KeySchema: [
          { AttributeName: 'GSI1PK', KeyType: 'HASH' },
          { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
  },

  // ─── Zalogram_Messages ───
  {
    TableName: 'Zalogram_Messages',
    KeySchema: [
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: 'S' },
      { AttributeName: 'SK', AttributeType: 'S' },
      { AttributeName: 'GSI1PK', AttributeType: 'S' },
      { AttributeName: 'GSI1SK', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'GSI-1',
        KeySchema: [
          { AttributeName: 'GSI1PK', KeyType: 'HASH' },
          { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
  },

  // ─── Zalogram_Contacts ───
  {
    TableName: 'Zalogram_Contacts',
    KeySchema: [
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: 'S' },
      { AttributeName: 'SK', AttributeType: 'S' },
      { AttributeName: 'GSI1PK', AttributeType: 'S' },
      { AttributeName: 'GSI1SK', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'GSI-1',
        KeySchema: [
          { AttributeName: 'GSI1PK', KeyType: 'HASH' },
          { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
  },

  // ─── Zalogram_Newsfeed ───
  {
    TableName: 'Zalogram_Newsfeed',
    KeySchema: [
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: 'S' },
      { AttributeName: 'SK', AttributeType: 'S' },
      { AttributeName: 'GSI1PK', AttributeType: 'S' },
      { AttributeName: 'GSI1SK', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'GSI-1',
        KeySchema: [
          { AttributeName: 'GSI1PK', KeyType: 'HASH' },
          { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
  },

  // ─── Zalogram_Notifications ───
  {
    TableName: 'Zalogram_Notifications',
    KeySchema: [
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: 'S' },
      { AttributeName: 'SK', AttributeType: 'S' },
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
  },
];

// ──────────────────────────────────────────────
// TTL Configuration
// ──────────────────────────────────────────────

const TTL_CONFIGS: { TableName: string; AttributeName: string }[] = [
  { TableName: 'Zalogram_Sessions', AttributeName: 'expiresAt' },
  { TableName: 'Zalogram_Notifications', AttributeName: 'expiresAt' },
];

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────

async function main() {
  console.log(`\n🔗 Connecting to DynamoDB at: ${endpoint}\n`);

  // Lấy danh sách bảng hiện có
  const existing = await client.send(new ListTablesCommand({}));
  const existingTables = new Set(existing.TableNames ?? []);

  // Tạo từng bảng
  for (const tableDef of TABLES) {
    const name = tableDef.TableName!;

    if (existingTables.has(name)) {
      console.log(`⏭️  Bảng "${name}" đã tồn tại — bỏ qua`);
      continue;
    }

    try {
      await client.send(new CreateTableCommand(tableDef));
      console.log(`✅ Tạo bảng "${name}" thành công`);
    } catch (error: unknown) {
      const err = error as Error;
      if (err.name === 'ResourceInUseException') {
        console.log(`⏭️  Bảng "${name}" đã tồn tại — bỏ qua`);
      } else {
        console.error(`❌ Lỗi tạo bảng "${name}":`, err.message);
      }
    }
  }

  // Bật TTL
  for (const ttl of TTL_CONFIGS) {
    try {
      await client.send(
        new UpdateTimeToLiveCommand({
          TableName: ttl.TableName,
          TimeToLiveSpecification: {
            Enabled: true,
            AttributeName: ttl.AttributeName,
          },
        }),
      );
      console.log(`⏰ Bật TTL cho "${ttl.TableName}" (field: ${ttl.AttributeName})`);
    } catch (error: unknown) {
      const err = error as Error;
      if (err.message?.includes('already enabled')) {
        console.log(`⏰ TTL cho "${ttl.TableName}" đã bật`);
      } else {
        console.error(`⚠️  Lỗi bật TTL "${ttl.TableName}":`, err.message);
      }
    }
  }

  console.log('\n🎉 Hoàn tất tạo bảng DynamoDB!\n');
}

main().catch((err) => {
  console.error('💥 Script thất bại:', err);
  process.exit(1);
});
