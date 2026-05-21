/* eslint-disable no-console -- CLI job script */
import { ScanCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient } from '../../src/config/database.js';
import { env } from '../../src/config/env.js';

const GROUPS_TABLE = `${env.DYNAMODB_TABLE_PREFIX}Groups`;

async function calculatePopularity() {
  console.log('== Bắt đầu chạy Scheduled Job tính điểm phổ biến Cộng đồng ==');
  console.log(`Bảng mục tiêu: ${GROUPS_TABLE}`);

  const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const sevenDaysAgoPadded = sevenDaysAgoMs.toString().padStart(13, '0');

  let lastEvaluatedKey: Record<string, any> | undefined;
  let scannedCount = 0;
  let updatedCount = 0;

  do {
    const scanResult = await dynamoClient.send(
      new ScanCommand({
        TableName: GROUPS_TABLE,
        FilterExpression: 'SK = :sk AND isActive = :active AND #status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':sk': 'META',
          ':active': true,
          ':status': 'active',
        },
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    const communities = (scanResult.Items as any[]) ?? [];
    scannedCount += communities.length;

    for (const community of communities) {
      const { groupId, memberCount = 0, postCount = 0, name } = community;
      try {
        // Đếm số lượng post mới trong 7 ngày
        const recentResult = await dynamoClient.send(
          new QueryCommand({
            TableName: GROUPS_TABLE,
            KeyConditionExpression: 'PK = :pk AND SK BETWEEN :startSK AND :endSK',
            ExpressionAttributeValues: {
              ':pk': `GROUP#${groupId}`,
              ':startSK': `CONTENT#${sevenDaysAgoPadded}`,
              ':endSK': `CONTENT#9999999999999`,
            },
            Select: 'COUNT',
          }),
        );
        const recentPostsCount = recentResult.Count ?? 0;

        // Công thức tính điểm phổ biến
        const score =
          0.5 * Math.log1p(memberCount) + 0.3 * Math.log1p(postCount) + 0.2 * recentPostsCount;
        const paddedScore = Math.round(score * 1000)
          .toString()
          .padStart(10, '0');

        const category = community.category || 'general';
        const gsi2pk = `CATEGORY#${category}`;
        const gsi2sk = `POPULAR#${paddedScore}#${groupId}`;

        // Cập nhật lại vào DB
        await dynamoClient.send(
          new UpdateCommand({
            TableName: GROUPS_TABLE,
            Key: { PK: `GROUP#${groupId}`, SK: 'META' },
            UpdateExpression:
              'SET popularityScore = :score, GSI2PK = :gsi2pk, GSI2SK = :gsi2sk, updatedAt = :now',
            ExpressionAttributeValues: {
              ':score': score,
              ':gsi2pk': gsi2pk,
              ':gsi2sk': gsi2sk,
              ':now': new Date().toISOString(),
            },
          }),
        );

        console.log(
          `[Cập nhật] Cộng đồng "${name}" (ID: ${groupId}) - Điểm: ${score.toFixed(4)} (Bài viết 7 ngày: ${recentPostsCount})`,
        );
        updatedCount++;
      } catch (err) {
        console.error(`[Lỗi] Không thể tính điểm cho cộng đồng "${name}" (ID: ${groupId}):`, err);
      }
    }

    lastEvaluatedKey = scanResult.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log(`== Hoàn tất job. Quét: ${scannedCount}, Cập nhật: ${updatedCount} cộng đồng ==`);
}

calculatePopularity().catch((err) => {
  console.error('Lỗi thực thi job tính điểm phổ biến:', err);
  process.exit(1);
});
