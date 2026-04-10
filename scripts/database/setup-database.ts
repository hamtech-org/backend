/* eslint-disable no-console -- CLI setup script */
import {
  DynamoDBClient,
  CreateTableCommand,
  ListTablesCommand,
  UpdateTimeToLiveCommand,
  type CreateTableCommandInput,
} from '@aws-sdk/client-dynamodb';
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

function tableName(name: string): string {
  return `${PREFIX}${name}`;
}

// -- Attribute shorthand --
const S = 'S';
const HASH = 'HASH';
const RANGE = 'RANGE';

function gsi(
  indexName: string,
  pk: string,
  sk?: string,
): NonNullable<CreateTableCommandInput['GlobalSecondaryIndexes']>[number] {
  const keySchema: { AttributeName: string; KeyType: 'HASH' | 'RANGE' }[] = [
    { AttributeName: pk, KeyType: HASH },
  ];
  if (sk) keySchema.push({ AttributeName: sk, KeyType: RANGE });
  return {
    IndexName: indexName,
    KeySchema: keySchema,
    Projection: { ProjectionType: 'ALL' },
  };
}

const tableDefinitions: CreateTableCommandInput[] = [
  // 1. Users
  {
    TableName: tableName('Users'),
    KeySchema: [
      { AttributeName: 'PK', KeyType: HASH },
      { AttributeName: 'SK', KeyType: RANGE },
    ],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: S },
      { AttributeName: 'SK', AttributeType: S },
      { AttributeName: 'GSI1PK', AttributeType: S },
      { AttributeName: 'GSI1SK', AttributeType: S },
    ],
    GlobalSecondaryIndexes: [gsi('GSI-1', 'GSI1PK', 'GSI1SK')],
    BillingMode: 'PAY_PER_REQUEST',
  },

  // 2. Sessions (TTL: expiresAt)
  {
    TableName: tableName('Sessions'),
    KeySchema: [
      { AttributeName: 'PK', KeyType: HASH },
      { AttributeName: 'SK', KeyType: RANGE },
    ],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: S },
      { AttributeName: 'SK', AttributeType: S },
      { AttributeName: 'GSI1PK', AttributeType: S },
      { AttributeName: 'GSI1SK', AttributeType: S },
    ],
    GlobalSecondaryIndexes: [gsi('GSI-1', 'GSI1PK', 'GSI1SK')],
    BillingMode: 'PAY_PER_REQUEST',
  },

  // 3. Conversations
  {
    TableName: tableName('Conversations'),
    KeySchema: [
      { AttributeName: 'PK', KeyType: HASH },
      { AttributeName: 'SK', KeyType: RANGE },
    ],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: S },
      { AttributeName: 'SK', AttributeType: S },
      { AttributeName: 'userId', AttributeType: S },
      { AttributeName: 'lastMessageAt', AttributeType: S },
    ],
    GlobalSecondaryIndexes: [gsi('GSI-1', 'userId', 'lastMessageAt'), gsi('GSI-2', 'userId')],
    BillingMode: 'PAY_PER_REQUEST',
  },

  // 4. Messages
  {
    TableName: tableName('Messages'),
    KeySchema: [
      { AttributeName: 'PK', KeyType: HASH },
      { AttributeName: 'SK', KeyType: RANGE },
    ],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: S },
      { AttributeName: 'SK', AttributeType: S },
      { AttributeName: 'senderId', AttributeType: S },
    ],
    GlobalSecondaryIndexes: [gsi('GSI-1', 'senderId')],
    BillingMode: 'PAY_PER_REQUEST',
  },

  // 5. MessageStatus
  {
    TableName: tableName('MessageStatus'),
    KeySchema: [
      { AttributeName: 'PK', KeyType: HASH },
      { AttributeName: 'SK', KeyType: RANGE },
    ],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: S },
      { AttributeName: 'SK', AttributeType: S },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },

  // 6. Contacts
  {
    TableName: tableName('Contacts'),
    KeySchema: [
      { AttributeName: 'PK', KeyType: HASH },
      { AttributeName: 'SK', KeyType: RANGE },
    ],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: S },
      { AttributeName: 'SK', AttributeType: S },
      { AttributeName: 'friendId', AttributeType: S },
      { AttributeName: 'userId', AttributeType: S },
    ],
    GlobalSecondaryIndexes: [gsi('GSI-1', 'friendId', 'userId')],
    BillingMode: 'PAY_PER_REQUEST',
  },

  // 7. Groups
  {
    TableName: tableName('Groups'),
    KeySchema: [
      { AttributeName: 'PK', KeyType: HASH },
      { AttributeName: 'SK', KeyType: RANGE },
    ],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: S },
      { AttributeName: 'SK', AttributeType: S },
      { AttributeName: 'userId', AttributeType: S },
    ],
    GlobalSecondaryIndexes: [gsi('GSI-1', 'userId')],
    BillingMode: 'PAY_PER_REQUEST',
  },

  // 8. Posts
  {
    TableName: tableName('Posts'),
    KeySchema: [
      { AttributeName: 'PK', KeyType: HASH },
      { AttributeName: 'SK', KeyType: RANGE },
    ],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: S },
      { AttributeName: 'SK', AttributeType: S },
      { AttributeName: 'authorId', AttributeType: S },
      { AttributeName: 'createdAt', AttributeType: S },
    ],
    GlobalSecondaryIndexes: [gsi('GSI-1', 'authorId', 'createdAt')],
    BillingMode: 'PAY_PER_REQUEST',
  },

  // 9. Reactions
  {
    TableName: tableName('Reactions'),
    KeySchema: [
      { AttributeName: 'PK', KeyType: HASH },
      { AttributeName: 'SK', KeyType: RANGE },
    ],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: S },
      { AttributeName: 'SK', AttributeType: S },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },

  // 10. Comments
  {
    TableName: tableName('Comments'),
    KeySchema: [
      { AttributeName: 'PK', KeyType: HASH },
      { AttributeName: 'SK', KeyType: RANGE },
    ],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: S },
      { AttributeName: 'SK', AttributeType: S },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },

  // 11. Reels
  {
    TableName: tableName('Reels'),
    KeySchema: [
      { AttributeName: 'PK', KeyType: HASH },
      { AttributeName: 'SK', KeyType: RANGE },
    ],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: S },
      { AttributeName: 'SK', AttributeType: S },
      { AttributeName: 'authorId', AttributeType: S },
      { AttributeName: 'createdAt', AttributeType: S },
    ],
    GlobalSecondaryIndexes: [gsi('GSI-1', 'authorId', 'createdAt')],
    BillingMode: 'PAY_PER_REQUEST',
  },

  // 12. Notifications (TTL: expiresAt)
  {
    TableName: tableName('Notifications'),
    KeySchema: [
      { AttributeName: 'PK', KeyType: HASH },
      { AttributeName: 'SK', KeyType: RANGE },
    ],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: S },
      { AttributeName: 'SK', AttributeType: S },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },

  // 13. ModerationLogs
  {
    TableName: tableName('ModerationLogs'),
    KeySchema: [
      { AttributeName: 'PK', KeyType: HASH },
      { AttributeName: 'SK', KeyType: RANGE },
    ],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: S },
      { AttributeName: 'SK', AttributeType: S },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },

  // 14. Analytics
  {
    TableName: tableName('Analytics'),
    KeySchema: [
      { AttributeName: 'PK', KeyType: HASH },
      { AttributeName: 'SK', KeyType: RANGE },
    ],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: S },
      { AttributeName: 'SK', AttributeType: S },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },
];

const TTL_TABLES: Record<string, string> = {
  [tableName('Sessions')]: 'expiresAt',
  [tableName('Notifications')]: 'expiresAt',
};

async function setupDatabase(): Promise<void> {
  console.log(`\n== Zalogram DynamoDB Setup ==`);
  console.log(`Endpoint : ${ENDPOINT}`);
  console.log(`Region   : ${REGION}`);
  console.log(`Prefix   : ${PREFIX}\n`);

  const { TableNames: existing = [] } = await client.send(new ListTablesCommand({}));

  let created = 0;
  let skipped = 0;

  for (const def of tableDefinitions) {
    const name = def.TableName!;
    if (existing.includes(name)) {
      console.log(`[skip] ${name} — da ton tai`);
      skipped++;
      continue;
    }

    try {
      await client.send(new CreateTableCommand(def));
      console.log(`[ok]   ${name} — tao thanh cong`);
      created++;

      if (TTL_TABLES[name]) {
        await client.send(
          new UpdateTimeToLiveCommand({
            TableName: name,
            TimeToLiveSpecification: {
              Enabled: true,
              AttributeName: TTL_TABLES[name],
            },
          }),
        );
        console.log(`       └─ TTL enabled: ${TTL_TABLES[name]}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[err]  ${name} — ${message}`);
    }
  }

  console.log(
    `\nKet qua: ${created} tao moi, ${skipped} da ton tai, tong ${tableDefinitions.length} bang.\n`,
  );
}

setupDatabase().catch((err) => {
  console.error('Loi khoi tao database:', err);
  process.exit(1);
});
