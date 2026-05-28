import {
  DynamoDBClient,
  DescribeTableCommand,
  UpdateTableCommand,
  type GlobalSecondaryIndexDescription,
} from '@aws-sdk/client-dynamodb';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitTableActive(client: DynamoDBClient, tableName: string): Promise<void> {
  const isLocal = !process.env.AWS_REGION || process.env.DYNAMODB_ENDPOINT?.includes('localhost');

  if (!isLocal) {
    console.log(`[Migration] Phát hiện môi trường AWS. Chờ GSI hoàn tất (polling 10s)...`);
  }

  for (;;) {
    const result = await client.send(new DescribeTableCommand({ TableName: tableName }));
    const creatingIndex = result.Table?.GlobalSecondaryIndexes?.find(
      (gsi) => gsi.IndexStatus && gsi.IndexStatus !== 'ACTIVE',
    );
    if (result.Table?.TableStatus === 'ACTIVE' && !creatingIndex) return;
    await sleep(10000);
  }
}

function getGSI1KeySchema(
  gsis: GlobalSecondaryIndexDescription[],
): { hashKey: string; rangeKey?: string } | null {
  const gsi1 = gsis.find((gsi) => gsi.IndexName === 'GSI-1');
  if (!gsi1) return null;
  const hashKey = gsi1.KeySchema?.find((k) => k.KeyType === 'HASH')?.AttributeName ?? '';
  const rangeKey = gsi1.KeySchema?.find((k) => k.KeyType === 'RANGE')?.AttributeName;
  return { hashKey, rangeKey };
}

/**
 * Migration: Recreate GSI-1 on Groups table.
 *
 * Old GSI-1: userId (HASH only) — created by migration 20260520_01
 * New GSI-1: GSI1PK (HASH) + GSI1SK (RANGE) — matches code query patterns
 *
 * Steps:
 * 1. If GSI-1 already has GSI1PK+GSI1SK → skip (already correct)
 * 2. If GSI-1 exists with old schema → delete it, wait ACTIVE
 * 3. Create GSI-1 with GSI1PK (HASH) + GSI1SK (RANGE), wait ACTIVE
 */
export async function up(client: DynamoDBClient, prefix: string): Promise<void> {
  const tableName = `${prefix}Groups`;
  const describe = await client.send(new DescribeTableCommand({ TableName: tableName }));
  const gsis = describe.Table?.GlobalSecondaryIndexes ?? [];

  const currentGSI1 = getGSI1KeySchema(gsis);

  // Already correct — skip
  if (currentGSI1 && currentGSI1.hashKey === 'GSI1PK' && currentGSI1.rangeKey === 'GSI1SK') {
    console.log(`[Migration] ${tableName} GSI-1 đã đúng schema (GSI1PK + GSI1SK). Bỏ qua.`);
    return;
  }

  // Delete old GSI-1 if it exists
  if (currentGSI1) {
    console.log(
      `[Migration] Xóa GSI-1 cũ (${currentGSI1.hashKey}${currentGSI1.rangeKey ? ' + ' + currentGSI1.rangeKey : ''}) trên ${tableName}...`,
    );
    await client.send(
      new UpdateTableCommand({
        TableName: tableName,
        GlobalSecondaryIndexUpdates: [
          {
            Delete: {
              IndexName: 'GSI-1',
            },
          },
        ],
      }),
    );
    console.log(`[Migration] Đang chờ bảng ACTIVE sau khi xóa GSI-1...`);
    await waitTableActive(client, tableName);
    console.log(`[Migration] Bảng ACTIVE. Tiến hành tạo GSI-1 mới.`);
  } else {
    console.log(`[Migration] ${tableName} chưa có GSI-1. Tiến hành tạo mới.`);
  }

  // Create new GSI-1 with GSI1PK + GSI1SK
  console.log(`[Migration] Tạo GSI-1 mới (GSI1PK + GSI1SK) trên ${tableName}...`);
  await client.send(
    new UpdateTableCommand({
      TableName: tableName,
      AttributeDefinitions: [
        { AttributeName: 'GSI1PK', AttributeType: 'S' },
        { AttributeName: 'GSI1SK', AttributeType: 'S' },
      ],
      GlobalSecondaryIndexUpdates: [
        {
          Create: {
            IndexName: 'GSI-1',
            KeySchema: [
              { AttributeName: 'GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
        },
      ],
    }),
  );
  console.log(`[Migration] Đang chờ GSI-1 mới ACTIVE...`);
  await waitTableActive(client, tableName);
  console.log(`[Migration] GSI-1 mới trên ${tableName} đã ACTIVE. Hoàn tất.`);
}
