#!/usr/bin/env node
/* eslint-disable no-console -- CLI backfill script */
/**
 * Backfill community analytics from historical data.
 *
 * - Quét table `Groups` lấy danh sách nhóm và thành viên hoạt động
 * - Quét table `Posts` lấy danh sách bài viết thuộc về nhóm
 * - Quét table `Comments` lấy danh sách bình luận thuộc về bài viết của nhóm
 * - Tổng hợp dữ liệu theo nhóm và theo ngày
 * - Ghi dữ liệu tổng hợp vào DynamoDB bảng Groups (GROUP#{groupId}#ANALYTICS)
 *
 * Chạy:
 *   npx tsx scripts/database/backfill-analytics.ts
 */
import dotenv from 'dotenv';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

dotenv.config();

const TABLE_PREFIX = process.env.DYNAMODB_TABLE_PREFIX ?? 'Zalogram_';
const GROUPS_TABLE = `${TABLE_PREFIX}Groups`;
const POSTS_TABLE = `${TABLE_PREFIX}Posts`;
const COMMENTS_TABLE = `${TABLE_PREFIX}Comments`;

const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';
const DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT?.trim();

const SCAN_LIMIT = 50;
const DELAY_MS = 100;
const WRITE_DELAY_MS = 30;

const dynamoConfig: ConstructorParameters<typeof DynamoDBClient>[0] = {
  region: AWS_REGION,
};
if (DYNAMODB_ENDPOINT) dynamoConfig.endpoint = DYNAMODB_ENDPOINT;
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  dynamoConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient(dynamoConfig), {
  marshallOptions: { removeUndefinedValues: true },
});

type DynamoRecord = Record<string, any>;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function backfillAnalytics(): Promise<void> {
  console.log('=== KHỞI CHẠY BACKFILL TIẾN TRÌNH THỐNG KÊ CỘNG ĐỒNG ===');
  console.log(`Groups Table: ${GROUPS_TABLE}`);
  console.log(`Posts Table: ${POSTS_TABLE}`);
  console.log(`Comments Table: ${COMMENTS_TABLE}`);
  console.log(
    `RCU Protection Throttling: Limit=${SCAN_LIMIT}, Scan Delay=${DELAY_MS}ms, Write Delay=${WRITE_DELAY_MS}ms`,
  );

  // 1. Quét danh sách các nhóm hợp lệ (để đối chiếu)
  const groupIds = new Set<string>();
  let lastKey: DynamoRecord | undefined;
  let hasMore = true;

  console.log('\nStep 1: Đang quét danh sách cộng đồng...');
  while (hasMore) {
    const res = await dynamoClient.send(
      new ScanCommand({
        TableName: GROUPS_TABLE,
        ExclusiveStartKey: lastKey,
        Limit: SCAN_LIMIT,
        FilterExpression: 'SK = :meta AND begins_with(PK, :groupPrefix)',
        ExpressionAttributeValues: {
          ':meta': 'META',
          ':groupPrefix': 'GROUP#',
        },
      }),
    );

    const items = res.Items ?? [];
    for (const item of items) {
      if (item.groupId) {
        groupIds.add(item.groupId);
      }
    }

    lastKey = res.LastEvaluatedKey;
    hasMore = Boolean(lastKey);
    if (hasMore) {
      await delay(DELAY_MS);
    }
  }
  console.log(`Tìm thấy ${groupIds.size} cộng đồng active.`);

  // 2. Lưu trữ cấu trúc aggregated data
  // Map<groupId, Map<date, { newMembers, leftMembers, posts, comments }>>
  const aggregation = new Map<
    string,
    Map<string, { newMembers: number; leftMembers: number; posts: number; comments: number }>
  >();

  const getOrCreatePoint = (gId: string, dStr: string) => {
    if (!aggregation.has(gId)) {
      aggregation.set(gId, new Map());
    }
    const groupMap = aggregation.get(gId)!;
    if (!groupMap.has(dStr)) {
      groupMap.set(dStr, { newMembers: 0, leftMembers: 0, posts: 0, comments: 0 });
    }
    return groupMap.get(dStr)!;
  };

  // 3. Quét danh sách thành viên trong GROUPS_TABLE
  lastKey = undefined;
  hasMore = true;
  console.log('\nStep 2: Đang quét thành viên để tính Member Growth...');
  let memberCount = 0;

  while (hasMore) {
    const res = await dynamoClient.send(
      new ScanCommand({
        TableName: GROUPS_TABLE,
        ExclusiveStartKey: lastKey,
        Limit: SCAN_LIMIT,
        FilterExpression: 'begins_with(SK, :memberPrefix) AND begins_with(PK, :groupPrefix)',
        ExpressionAttributeValues: {
          ':memberPrefix': 'MEMBER#',
          ':groupPrefix': 'GROUP#',
        },
      }),
    );

    const items = res.Items ?? [];
    for (const item of items) {
      const gId = item.groupId;
      const uId = item.userId;
      if (!gId || !uId || !groupIds.has(gId)) continue;

      memberCount++;
      // Tính join date
      let joinedDate = new Date().toISOString().split('T')[0];
      if (item.joinedAt) {
        joinedDate = item.joinedAt.split('T')[0];
      } else if (item.createdAt) {
        joinedDate = item.createdAt.split('T')[0];
      }

      const point = getOrCreatePoint(gId, joinedDate);
      if (item.status === 'active') {
        point.newMembers++;
      } else if (item.status === 'banned') {
        point.leftMembers++;
      }
    }

    lastKey = res.LastEvaluatedKey;
    hasMore = Boolean(lastKey);
    if (hasMore) {
      await delay(DELAY_MS);
    }
  }
  console.log(`Đã quét xong ${memberCount} bản ghi thành viên.`);

  // 4. Quét danh sách bài viết từ POSTS_TABLE
  // Vừa tổng hợp post vừa xây dựng map postId -> groupId để phục vụ quét bình luận
  const postToGroupMap = new Map<string, string>();
  lastKey = undefined;
  hasMore = true;
  console.log('\nStep 3: Đang quét bài viết...');
  let postCount = 0;

  while (hasMore) {
    const res = await dynamoClient.send(
      new ScanCommand({
        TableName: POSTS_TABLE,
        ExclusiveStartKey: lastKey,
        Limit: SCAN_LIMIT,
        FilterExpression: 'attribute_exists(groupId)',
      }),
    );

    const items = res.Items ?? [];
    for (const item of items) {
      const gId = item.groupId ?? item.communityId;
      const postId = item.postId;
      if (!gId || !postId || !groupIds.has(gId)) continue;

      postToGroupMap.set(postId, gId);
      postCount++;

      let postDate = new Date().toISOString().split('T')[0];
      if (item.createdAt) {
        postDate = item.createdAt.split('T')[0];
      }

      const point = getOrCreatePoint(gId, postDate);
      // Chỉ tính bài viết đã được duyệt hoặc không ở trạng thái pending
      if (item.status !== 'pending' && item.status !== 'rejected') {
        point.posts++;
      }
    }

    lastKey = res.LastEvaluatedKey;
    hasMore = Boolean(lastKey);
    if (hasMore) {
      await delay(DELAY_MS);
    }
  }
  console.log(`Đã quét xong ${postCount} bài viết thuộc cộng đồng.`);

  // 5. Quét danh sách bình luận từ COMMENTS_TABLE
  lastKey = undefined;
  hasMore = true;
  console.log('\nStep 4: Đang quét bình luận...');
  let commentCount = 0;

  while (hasMore) {
    const res = await dynamoClient.send(
      new ScanCommand({
        TableName: COMMENTS_TABLE,
        ExclusiveStartKey: lastKey,
        Limit: SCAN_LIMIT,
      }),
    );

    const items = res.Items ?? [];
    for (const item of items) {
      const postId = item.postId;
      if (!postId) continue;

      const gId = postToGroupMap.get(postId);
      if (!gId) continue; // không thuộc bài viết cộng đồng nào

      commentCount++;
      let commentDate = new Date().toISOString().split('T')[0];
      if (item.createdAt) {
        commentDate = item.createdAt.split('T')[0];
      }

      const point = getOrCreatePoint(gId, commentDate);
      point.comments++;
    }

    lastKey = res.LastEvaluatedKey;
    hasMore = Boolean(lastKey);
    if (hasMore) {
      await delay(DELAY_MS);
    }
  }
  console.log(`Đã quét xong ${commentCount} bình luận thuộc bài viết cộng đồng.`);

  // 6. Ghi dữ liệu vào DynamoDB
  console.log('\nStep 5: Đang ghi dữ liệu phân tích lịch sử vào DynamoDB...');
  let writeCount = 0;

  for (const [gId, dateMap] of aggregation.entries()) {
    for (const [date, counts] of dateMap.entries()) {
      // Chỉ ghi nếu có chỉ số lớn hơn 0
      if (
        counts.newMembers === 0 &&
        counts.leftMembers === 0 &&
        counts.posts === 0 &&
        counts.comments === 0
      ) {
        continue;
      }

      try {
        await dynamoClient.send(
          new UpdateCommand({
            TableName: GROUPS_TABLE,
            Key: { PK: `GROUP#${gId}#ANALYTICS`, SK: `DATE#${date}` },
            UpdateExpression:
              'SET newMembersCount = :newM, leftMembersCount = :leftM, postsCount = :posts, commentsCount = :comments, updatedAt = :now, groupId = :gId, #dateAttr = :date',
            ExpressionAttributeNames: {
              '#dateAttr': 'date',
            },
            ExpressionAttributeValues: {
              ':newM': counts.newMembers,
              ':leftM': counts.leftMembers,
              ':posts': counts.posts,
              ':comments': counts.comments,
              ':now': new Date().toISOString(),
              ':gId': gId,
              ':date': date,
            },
          }),
        );
        writeCount++;
        if (writeCount % 50 === 0) {
          console.log(`Đã ghi thành công ${writeCount} bản ghi thống kê ngày...`);
        }
        await delay(WRITE_DELAY_MS);
      } catch (err) {
        console.error(`Lỗi ghi thống kê cho nhóm ${gId} ngày ${date}:`, err);
      }
    }
  }

  console.log(`\n=== BACKFILL TIẾN TRÌNH THÀNH CÔNG ===`);
  console.log(`Tổng số bản ghi thống kê được lưu: ${writeCount}`);
}

backfillAnalytics().catch((err) => {
  console.error('Tiến trình backfill thất bại:', err);
  process.exit(1);
});
