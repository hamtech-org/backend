import {
  DynamoDBClient,
  DescribeTableCommand,
  PutItemCommand,
  ScanCommand,
  UpdateItemCommand,
  UpdateTableCommand,
  type AttributeValue,
  type GlobalSecondaryIndexDescription,
} from '@aws-sdk/client-dynamodb';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeSlug = (input: string): string => {
  const slug = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return slug || `community-${Date.now()}`;
};

async function waitTableActive(client: DynamoDBClient, tableName: string): Promise<void> {
  for (;;) {
    const result = await client.send(new DescribeTableCommand({ TableName: tableName }));
    const creatingIndex = result.Table?.GlobalSecondaryIndexes?.find(
      (gsi) => gsi.IndexStatus && gsi.IndexStatus !== 'ACTIVE',
    );
    if (result.Table?.TableStatus === 'ACTIVE' && !creatingIndex) return;
    await sleep(10000);
  }
}

function hasIndex(gsis: GlobalSecondaryIndexDescription[], indexName: string): boolean {
  return gsis.some((gsi) => gsi.IndexName === indexName);
}

export async function up(client: DynamoDBClient, prefix: string): Promise<void> {
  const tableName = `${prefix}Groups`;
  const describe = await client.send(new DescribeTableCommand({ TableName: tableName }));
  const gsis = describe.Table?.GlobalSecondaryIndexes ?? [];

  if (!hasIndex(gsis, 'GSI-1')) {
    console.log(`[Migration] Thêm GSI-1 cho joined communities trên ${tableName}`);
    await client.send(
      new UpdateTableCommand({
        TableName: tableName,
        AttributeDefinitions: [{ AttributeName: 'userId', AttributeType: 'S' }],
        GlobalSecondaryIndexUpdates: [
          {
            Create: {
              IndexName: 'GSI-1',
              KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
              Projection: { ProjectionType: 'ALL' },
            },
          },
        ],
      }),
    );
    await waitTableActive(client, tableName);
  } else {
    console.log(`[Migration] ${tableName} đã có GSI-1, bỏ qua tạo index.`);
  }

  const refreshed = await client.send(new DescribeTableCommand({ TableName: tableName }));
  const refreshedGsis = refreshed.Table?.GlobalSecondaryIndexes ?? [];
  if (!hasIndex(refreshedGsis, 'GSI-2')) {
    console.log(`[Migration] Thêm GSI-2 cho community discovery trên ${tableName}`);
    await client.send(
      new UpdateTableCommand({
        TableName: tableName,
        AttributeDefinitions: [
          { AttributeName: 'GSI2PK', AttributeType: 'S' },
          { AttributeName: 'GSI2SK', AttributeType: 'S' },
        ],
        GlobalSecondaryIndexUpdates: [
          {
            Create: {
              IndexName: 'GSI-2',
              KeySchema: [
                { AttributeName: 'GSI2PK', KeyType: 'HASH' },
                { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
              ],
              Projection: { ProjectionType: 'ALL' },
            },
          },
        ],
      }),
    );
    await waitTableActive(client, tableName);
  } else {
    console.log(`[Migration] ${tableName} đã có GSI-2, bỏ qua tạo index.`);
  }

  let lastEvaluatedKey: Record<string, AttributeValue> | undefined;
  let backfilled = 0;
  do {
    const result = await client.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    for (const item of result.Items ?? []) {
      const pk = item.PK?.S;
      const sk = item.SK?.S;
      if (!pk || !sk) continue;

      if (pk.startsWith('GROUP#') && sk === 'META') {
        const groupId = item.groupId?.S ?? pk.slice('GROUP#'.length);
        const name = item.name?.S ?? 'community';
        const createdAt = item.createdAt?.S ?? new Date(0).toISOString();
        const createdAtMs = item.createdAtMs?.N ?? String(new Date(createdAt).getTime() || 0);
        const category = item.category?.S ?? 'general';
        const slug = item.slug?.S ?? normalizeSlug(`${name}-${groupId.slice(0, 8)}`);
        const ownerId = item.ownerId?.S ?? item.creatorId?.S ?? '';
        const joinPolicy =
          item.joinPolicy?.S ?? (item.isApprovalRequired?.BOOL ? 'approval' : 'open');

        await client.send(
          new UpdateItemCommand({
            TableName: tableName,
            Key: { PK: item.PK, SK: item.SK },
            UpdateExpression:
              'SET communityId = if_not_exists(communityId, :gid), slug = if_not_exists(slug, :slug), category = if_not_exists(category, :category), joinPolicy = if_not_exists(joinPolicy, :joinPolicy), ownerId = if_not_exists(ownerId, :ownerId), postCount = if_not_exists(postCount, :zero), popularityScore = if_not_exists(popularityScore, :zero), isActive = if_not_exists(isActive, :active), #status = if_not_exists(#status, :status), createdAtMs = if_not_exists(createdAtMs, :createdAtMs), GSI2PK = :gsi2pk, GSI2SK = :gsi2sk',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':gid': { S: groupId },
              ':slug': { S: slug },
              ':category': { S: category },
              ':joinPolicy': { S: joinPolicy },
              ':ownerId': { S: ownerId },
              ':zero': { N: '0' },
              ':active': { BOOL: true },
              ':status': { S: 'active' },
              ':createdAtMs': { N: createdAtMs },
              ':gsi2pk': { S: `CATEGORY#${category}` },
              ':gsi2sk': { S: `CREATED#${createdAtMs.padStart(13, '0')}#${groupId}` },
            },
          }),
        );

        await client
          .send(
            new PutItemCommand({
              TableName: tableName,
              Item: {
                PK: { S: `SLUG#${slug}` },
                SK: { S: 'GROUP' },
                slug: { S: slug },
                groupId: { S: groupId },
                communityId: { S: groupId },
                createdAt: { S: createdAt },
              },
              ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
            }),
          )
          .catch(() => undefined);
        backfilled++;
      }

      if (pk.startsWith('GROUP#') && sk.startsWith('MEMBER#')) {
        const groupId = item.groupId?.S ?? pk.slice('GROUP#'.length);
        const userId = item.userId?.S ?? sk.slice('MEMBER#'.length);
        const joinedAt = item.joinedAt?.S ?? new Date(0).toISOString();
        const joinedAtMs = item.joinedAtMs?.N ?? String(new Date(joinedAt).getTime() || 0);
        await client.send(
          new UpdateItemCommand({
            TableName: tableName,
            Key: { PK: item.PK, SK: item.SK },
            UpdateExpression:
              'SET communityId = if_not_exists(communityId, :gid), userId = if_not_exists(userId, :uid), #status = if_not_exists(#status, :activeStatus), joinedAtMs = if_not_exists(joinedAtMs, :joinedAtMs), GSI1PK = :gsi1pk, GSI1SK = :gsi1sk',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':gid': { S: groupId },
              ':uid': { S: userId },
              ':activeStatus': { S: 'active' },
              ':joinedAtMs': { N: joinedAtMs },
              ':gsi1pk': { S: `USER#${userId}` },
              ':gsi1sk': { S: `JOINED#${joinedAtMs.padStart(13, '0')}#${groupId}` },
            },
          }),
        );
        backfilled++;
      }
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log(`[Migration] Hoàn tất community Groups backfill: ${backfilled} records.`);
}
