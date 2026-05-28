import {
  DynamoDBClient,
  DescribeTableCommand,
  ScanCommand,
  UpdateItemCommand,
  type AttributeValue,
  type ScanCommandOutput,
} from '@aws-sdk/client-dynamodb';

export async function up(client: DynamoDBClient, prefix: string): Promise<void> {
  const tableName = `${prefix}Groups`;
  console.log(
    `[Migration] Tiến hành bổ sung trường cấu hình Auto-Mod cho các bản ghi Community META trong bảng ${tableName}...`,
  );

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

      // Chỉ xử lý các bản ghi cấu hình của Community (Group META)
      if (pk.startsWith('GROUP#') && sk === 'META') {
        // Chỉ cập nhật nếu các trường cấu hình chưa tồn tại
        if (
          item.autoModerateEnabled === undefined ||
          item.autoModerateAction === undefined ||
          item.blacklistedKeywords === undefined
        ) {
          const updates: Record<string, AttributeValue> = {
            autoModerateEnabled: { BOOL: false },
            autoModerateAction: { S: 'censor' },
            blacklistedKeywords: { L: [] },
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

  console.log(
    `[Migration] Hoàn tất bổ sung cấu hình Auto-Mod cho ${backfilledCount} bản ghi Community META.`,
  );
}
