import {
  DynamoDBClient,
  DescribeTableCommand,
  UpdateTableCommand,
  ScanCommand,
  UpdateItemCommand,
  type AttributeValue,
  type ScanCommandOutput,
} from '@aws-sdk/client-dynamodb';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitTableActive(client: DynamoDBClient, tableName: string): Promise<void> {
  const isLocal = !process.env.AWS_REGION || process.env.DYNAMODB_ENDPOINT?.includes('localhost');

  if (!isLocal) {
    console.log(
      `[Migration] Phát hiện môi trường AWS. Lệnh UpdateTable được thực hiện ngầm. Chờ 5 giây rồi tiếp tục...`,
    );
    await sleep(5000);
    return;
  }

  console.log(`[Migration] Phát hiện môi trường Local. Bắt đầu đợi GSI đạt trạng thái ACTIVE...`);
  for (;;) {
    const result = await client.send(new DescribeTableCommand({ TableName: tableName }));
    const creatingIndex = result.Table?.GlobalSecondaryIndexes?.find(
      (gsi) => gsi.IndexStatus && gsi.IndexStatus !== 'ACTIVE',
    );
    if (result.Table?.TableStatus === 'ACTIVE' && !creatingIndex) return;
    await sleep(5000);
  }
}

export async function up(client: DynamoDBClient, prefix: string): Promise<void> {
  const tableName = `${prefix}Reports`;
  const describeResult = await client.send(new DescribeTableCommand({ TableName: tableName }));
  const gsis = describeResult.Table?.GlobalSecondaryIndexes || [];
  const hasGSI = gsis.some((gsi) => gsi.IndexName === 'GSI-CommunityReports');

  if (!hasGSI) {
    console.log(
      `[Migration] Bảng ${tableName} chưa có GSI-CommunityReports. Tiến hành UpdateTable...`,
    );
    await client.send(
      new UpdateTableCommand({
        TableName: tableName,
        AttributeDefinitions: [
          { AttributeName: 'groupId', AttributeType: 'S' },
          { AttributeName: 'createdAt', AttributeType: 'S' },
        ],
        GlobalSecondaryIndexUpdates: [
          {
            Create: {
              IndexName: 'GSI-CommunityReports',
              KeySchema: [
                { AttributeName: 'groupId', KeyType: 'HASH' },
                { AttributeName: 'createdAt', KeyType: 'RANGE' },
              ],
              Projection: { ProjectionType: 'ALL' },
            },
          },
        ],
      }),
    );
    await waitTableActive(client, tableName);
    console.log(`[Migration] Bảng ${tableName} đã cập nhật GSI-CommunityReports thành công.`);
  } else {
    console.log(`[Migration] Bảng ${tableName} đã có sẵn GSI-CommunityReports.`);
  }

  // 2. Backfill dữ liệu (Cho các bản ghi báo cáo cũ)
  console.log(`[Migration] Tiến hành backfill dữ liệu cho các bản ghi báo cáo cũ...`);
  let lastEvaluatedKey: Record<string, AttributeValue> | undefined = undefined;
  let backfilledCount = 0;

  do {
    const scanResult: ScanCommandOutput = await client.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    const items = scanResult.Items || [];
    for (const item of items) {
      const pk = item.PK?.S;
      const sk = item.SK?.S;
      if (!pk || !sk) continue;

      if (!item.groupId?.S) {
        let groupId = '';
        if (pk.startsWith('GROUP#')) {
          groupId = pk.slice('GROUP#'.length);
        } else {
          // Gán mặc định cho Reels cũ
          groupId = 'general';
        }

        if (groupId) {
          const updates: Record<string, AttributeValue> = {
            groupId: { S: groupId },
            status: item.status?.S ? item.status : { S: 'pending' },
          };

          const updateEntries = Object.entries(updates);
          const updateExpr = 'SET ' + updateEntries.map(([k], i) => `#k${i} = :v${i}`).join(', ');
          const exprAttrNames = Object.fromEntries(updateEntries.map(([k], i) => [`#k${i}`, k]));
          const exprAttrValues = Object.fromEntries(updateEntries.map(([, v], i) => [`:v${i}`, v]));

          await client.send(
            new UpdateItemCommand({
              TableName: tableName,
              Key: { PK: item.PK, SK: item.SK },
              UpdateExpression: updateExpr,
              ExpressionAttributeNames: exprAttrNames,
              ExpressionAttributeValues: exprAttrValues,
            }),
          );
          backfilledCount++;
        }
      }
    }
    lastEvaluatedKey = scanResult.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log(`[Migration] Hoàn tất backfill cho ${backfilledCount} bản ghi báo cáo cũ.`);
}
