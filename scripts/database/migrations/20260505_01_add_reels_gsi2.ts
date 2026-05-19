import {
  DynamoDBClient,
  DescribeTableCommand,
  UpdateTableCommand,
  ScanCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';

export async function up(client: DynamoDBClient, prefix: string): Promise<void> {
  const tableName = `${prefix}Reels`;

  // 1. Kiểm tra xem GSI-2 đã tồn tại chưa
  const describeResult = await client.send(new DescribeTableCommand({ TableName: tableName }));

  const gsis = describeResult.Table?.GlobalSecondaryIndexes || [];
  const hasGSI2 = gsis.some((gsi) => gsi.IndexName === 'GSI-2');

  if (!hasGSI2) {
    console.log(`[Migration] Bảng ${tableName} chưa có GSI-2. Tiến hành UpdateTable...`);

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

    console.log(`[Migration] Lệnh UpdateTable thành công. Trạng thái GSI-2 có thể đang CREATING.`);
    console.log(
      `[Migration] Tạm chờ 10 giây để index sẵn sàng trên môi trường Local (Với Prod AWS cần chờ lâu hơn).`,
    );
    await new Promise((resolve) => setTimeout(resolve, 10000));
  } else {
    console.log(`[Migration] Bảng ${tableName} đã có sẵn GSI-2, bỏ qua bước UpdateTable.`);
  }

  // 2. Backfill dữ liệu
  console.log(`[Migration] Đang quét các bản ghi cũ để bổ sung GSI2PK và GSI2SK...`);

  let lastEvaluatedKey: Record<string, any> | undefined = undefined;
  let backfilledCount = 0;

  do {
    const scanResult = await client.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'attribute_not_exists(GSI2PK)',
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    const items = scanResult.Items || [];

    for (const item of items) {
      if (item.PK?.S && item.createdAt?.S && item.reelId?.S) {
        // Cập nhật từng bản ghi
        await client.send(
          new UpdateItemCommand({
            TableName: tableName,
            Key: {
              PK: item.PK,
              SK: item.SK,
            },
            UpdateExpression: 'SET GSI2PK = :pk, GSI2SK = :sk',
            ExpressionAttributeValues: {
              ':pk': { S: 'REEL' },
              ':sk': { S: `${item.createdAt.S}#${item.reelId.S}` },
            },
          }),
        );
        backfilledCount++;
      }
    }

    lastEvaluatedKey = scanResult.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log(`[Migration] Hoàn tất backfill cho ${backfilledCount} bản ghi cũ.`);
}
