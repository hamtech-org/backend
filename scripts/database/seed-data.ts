/* eslint-disable no-console -- CLI seed script */
/**
 * @deprecated Sử dụng `insert-data.ts` + folder `data/*.json` thay thế.
 *
 * File này được giữ lại làm tham khảo. Script mới:
 *   npx tsx scripts/database/insert-data.ts
 *   # hoặc: npm run db:seed
 *
 * Legacy script: tạo dữ liệu mẫu hardcode để kiểm thử tính năng nhắn tin.
 *
 * Tạo ra:
 *  - 4 người dùng (alice, bob, charlie, diana)
 *  - 2 cuộc trò chuyện 1-1 (alice↔bob, alice↔charlie)
 *  - 1 cuộc trò chuyện nhóm (alice + bob + charlie + diana)
 *  - ~10 tin nhắn cho mỗi cuộc trò chuyện
 *
 * Chạy (legacy):
 *   npx tsx scripts/database/seed-data.ts
 *   # hoặc: npm run db:seed:legacy
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

dotenv.config();

// ─── Config ───────────────────────────────────────────────────────────────────

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
const db = DynamoDBDocumentClient.from(client);

const T = {
  USERS: `${PREFIX}Users`,
  CONVERSATIONS: `${PREFIX}Conversations`,
  MESSAGES: `${PREFIX}Messages`,
  MESSAGE_STATUS: `${PREFIX}MessageStatus`,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ts(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

/** Loại bỏ các giá trị undefined/null trước khi ghi vào DynamoDB.
 *  DynamoDB local không chấp nhận null cho key attribute;
 *  bỏ hẳn thuộc tính là cách an toàn nhất. */
function stripNulls(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));
}

async function put(table: string, item: Record<string, unknown>): Promise<void> {
  await db.send(new PutCommand({ TableName: table, Item: stripNulls(item) }));
}

/** Kiểm tra item đã tồn tại chưa để tránh ghi đè khi chạy lại */
async function exists(table: string, pk: string, sk: string): Promise<boolean> {
  const res = await db.send(new GetCommand({ TableName: table, Key: { PK: pk, SK: sk } }));
  return !!res.Item;
}

// ─── Seed Users ───────────────────────────────────────────────────────────────

interface SeedUser {
  userId: string;
  email: string;
  displayName: string;
  avatar: string;
  bio: string;
  passwordHash: string;
}

const PASSWORD = 'Test@1234'; // mật khẩu chung cho tất cả seed users

async function seedUsers(): Promise<SeedUser[]> {
  console.log('\n── Tạo người dùng ──');
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const profiles = [
    {
      userId: 'seed-user-alice',
      email: 'huycoi210804@gmail.com',
      displayName: 'Alice Nguyễn',
      avatar: 'https://i.pravatar.cc/150?u=alice',
      bio: 'Frontend developer yêu thích thiết kế UI/UX.',
    },
    {
      userId: 'seed-user-bob',
      email: 'ngonhuthuy1@gmail.com',
      displayName: 'Bob Trần',
      avatar: 'https://i.pravatar.cc/150?u=bob',
      bio: 'Backend engineer, thích cà phê và code sạch.',
    },
    {
      userId: 'seed-user-charlie',
      email: 'ngonhuthuy1234@gmail.com',
      displayName: 'Charlie Lê',
      avatar: 'https://i.pravatar.cc/150?u=charlie',
      bio: 'Full-stack dev, đam mê open source.',
    },
    {
      userId: 'seed-user-diana',
      email: 'diana@zalogram.test',
      displayName: 'Diana Phạm',
      avatar: 'https://i.pravatar.cc/150?u=diana',
      bio: 'DevOps / Cloud architect.',
    },
  ];

  const now = ts();
  const users: SeedUser[] = [];

  for (const p of profiles) {
    const alreadyExists = await exists(T.USERS, `USER#${p.userId}`, 'PROFILE');
    if (alreadyExists) {
      console.log(`  [skip] ${p.displayName} <${p.email}> — đã tồn tại`);
      users.push({ ...p, passwordHash });
      continue;
    }

    await put(T.USERS, {
      PK: `USER#${p.userId}`,
      SK: 'PROFILE',
      GSI1PK: `EMAIL#${p.email}`,
      GSI1SK: `EMAIL#${p.email}`,
      userId: p.userId,
      email: p.email,
      passwordHash,
      displayName: p.displayName,
      avatar: p.avatar,
      bio: p.bio,
      phone: null,
      status: 'offline',
      role: 'user',
      isVerified: true,
      lastSeen: now,
      tokenVersion: 0,
      faceLoginEnabled: false,
      rekognitionFaceId: null,
      oauthProvider: 'local',
      oauthId: null,
      publicKey: null,
      settings: {},
      createdAt: now,
      updatedAt: now,
    });
    console.log(`  [ok]   ${p.displayName} <${p.email}>`);
    users.push({ ...p, passwordHash });
  }

  return users;
}

// ─── Seed Conversations & Messages ───────────────────────────────────────────

interface ConvDef {
  conversationId: string;
  type: 'direct' | 'group';
  name: string | null;
  memberIds: string[];
  ownerIdx: number; // index trong memberIds
}

async function seedConversation(conv: ConvDef): Promise<void> {
  const now = ts();

  // Bỏ qua nếu đã tồn tại
  if (await exists(T.CONVERSATIONS, `CONV#${conv.conversationId}`, 'META')) {
    console.log(`  [skip] conversation "${conv.name ?? conv.conversationId}" — đã tồn tại`);
    return;
  }

  // META — không đưa null vào các GSI key attribute (lastMessageAt kiểu String)
  // DynamoDB sẽ không index item này trong GSI-1 cho đến khi có tin nhắn đầu tiên
  const metaItem: Record<string, unknown> = {
    PK: `CONV#${conv.conversationId}`,
    SK: 'META',
    conversationId: conv.conversationId,
    type: conv.type,
    creatorId: conv.memberIds[conv.ownerIdx],
    memberCount: conv.memberIds.length,
    isEncrypted: false,
    createdAt: now,
    updatedAt: now,
  };
  if (conv.name !== null) metaItem['name'] = conv.name;

  await put(T.CONVERSATIONS, metaItem);

  // MEMBER items — cần có `userId` để GSI-2 hoạt động
  for (let i = 0; i < conv.memberIds.length; i++) {
    const uid = conv.memberIds[i];
    const role = i === conv.ownerIdx ? 'owner' : 'member';
    await put(T.CONVERSATIONS, {
      PK: `CONV#${conv.conversationId}`,
      SK: `MEMBER#${uid}`,
      userId: uid, // GSI-2 partition key
      conversationId: conv.conversationId,
      role,
      joinedAt: now,
      lastReadAt: null,
      unreadCount: 0,
      isMuted: false,
      nickname: null,
    });
  }

  console.log(
    `  [ok]   conversation "${conv.name ?? conv.type}" (${conv.memberIds.length} thành viên)`,
  );
}

// ─── Seed Messages ────────────────────────────────────────────────────────────

interface MessageDef {
  conversationId: string;
  senderId: string;
  content: string;
  offsetMs: number; // thời gian tương đối từ "now" (âm = trong quá khứ)
}

async function seedMessage(def: MessageDef): Promise<void> {
  const messageId = uuidv4();
  const createdAt = ts(def.offsetMs);
  const sortKey = `MSG#${createdAt}#${messageId}`;

  await put(T.MESSAGES, {
    PK: `CONV#${def.conversationId}`,
    SK: sortKey,
    messageId,
    conversationId: def.conversationId,
    senderId: def.senderId,
    type: 'text',
    content: def.content,
    encryptedContent: null,
    mediaUrl: null,
    mediaType: null,
    mediaSize: null,
    mediaOriginalName: null,
    thumbnailUrl: null,
    replyTo: null,
    forwardFrom: null,
    isPinned: false,
    isEdited: false,
    isRecalled: false,
    isDeleted: false,
    reactions: {},
    createdAt,
    updatedAt: createdAt,
  });

  // Cập nhật lastMessage trên conversation META
  await db.send(
    new UpdateCommand({
      TableName: T.CONVERSATIONS,
      Key: { PK: `CONV#${def.conversationId}`, SK: 'META' },
      UpdateExpression: 'SET lastMessage = :lm, lastMessageAt = :lma, updatedAt = :now',
      ExpressionAttributeValues: {
        ':lm': {
          messageId,
          senderId: def.senderId,
          content: def.content.slice(0, 100),
          type: 'text',
          createdAt,
        },
        ':lma': createdAt,
        ':now': createdAt,
      },
    }),
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║   Zalogram — Seed Data               ║');
  console.log('╚══════════════════════════════════════╝');
  console.log(`Endpoint : ${ENDPOINT}`);
  console.log(`Prefix   : ${PREFIX}`);

  // 1. Users
  const users = await seedUsers();
  const [alice, bob, charlie, diana] = users;

  // 2. Conversations
  console.log('\n── Tạo cuộc trò chuyện ──');

  const CONV_ALICE_BOB = 'seed-conv-alice-bob';
  const CONV_ALICE_CHARLIE = 'seed-conv-alice-charlie';
  const CONV_GROUP = 'seed-conv-group-dev';
  const CONV_BOB_CHARLIE = 'seed-conv-bob-charlie';

  await seedConversation({
    conversationId: CONV_BOB_CHARLIE,
    type: 'direct',
    name: null,
    memberIds: [bob.userId, charlie.userId],
    ownerIdx: 0,
  });

  await seedConversation({
    conversationId: CONV_ALICE_BOB,
    type: 'direct',
    name: null,
    memberIds: [alice.userId, bob.userId],
    ownerIdx: 0,
  });

  await seedConversation({
    conversationId: CONV_ALICE_CHARLIE,
    type: 'direct',
    name: null,
    memberIds: [alice.userId, charlie.userId],
    ownerIdx: 0,
  });

  await seedConversation({
    conversationId: CONV_GROUP,
    type: 'group',
    name: 'Nhóm Dev Zalogram',
    memberIds: [alice.userId, bob.userId, charlie.userId, diana.userId],
    ownerIdx: 0,
  });

  // 3. Messages
  console.log('\n── Tạo tin nhắn ──');

  // Alice ↔ Bob
  console.log('  Alice ↔ Bob:');
  const aliceBobMessages: MessageDef[] = [
    {
      conversationId: CONV_ALICE_BOB,
      senderId: alice.userId,
      content: 'Hey Bob! Bạn có rảnh hôm nay không?',
      offsetMs: -3600_000 * 3,
    },
    {
      conversationId: CONV_ALICE_BOB,
      senderId: bob.userId,
      content: 'Có chứ! Có gì vậy Alice?',
      offsetMs: -3600_000 * 3 + 60_000,
    },
    {
      conversationId: CONV_ALICE_BOB,
      senderId: alice.userId,
      content: 'Mình cần review cái PR về chat feature. Bạn có thể xem giúp mình không?',
      offsetMs: -3600_000 * 3 + 120_000,
    },
    {
      conversationId: CONV_ALICE_BOB,
      senderId: bob.userId,
      content: 'Được, link PR đâu gửi mình xem nào',
      offsetMs: -3600_000 * 3 + 180_000,
    },
    {
      conversationId: CONV_ALICE_BOB,
      senderId: alice.userId,
      content: 'Đây: github.com/zalogram/backend/pull/42',
      offsetMs: -3600_000 * 3 + 240_000,
    },
    {
      conversationId: CONV_ALICE_BOB,
      senderId: bob.userId,
      content: 'OK để mình check. Code nhìn clean đó 👍',
      offsetMs: -3600_000 * 2,
    },
    {
      conversationId: CONV_ALICE_BOB,
      senderId: alice.userId,
      content: 'Cảm ơn bạn nhiều nha! 🙏',
      offsetMs: -3600_000 * 2 + 60_000,
    },
    {
      conversationId: CONV_ALICE_BOB,
      senderId: bob.userId,
      content: 'Có 1 chỗ mình comment rồi, bạn kiểm tra lại nhé',
      offsetMs: -3600_000,
    },
    {
      conversationId: CONV_ALICE_BOB,
      senderId: alice.userId,
      content: 'Đã fix xong, bạn re-review giúp nhé!',
      offsetMs: -1800_000,
    },
    {
      conversationId: CONV_ALICE_BOB,
      senderId: bob.userId,
      content: 'Approved! Ship thôi 🚀',
      offsetMs: -900_000,
    },
  ];

  for (const msg of aliceBobMessages) {
    await seedMessage(msg);
    process.stdout.write('.');
  }
  console.log(` ${aliceBobMessages.length} tin nhắn`);

  // Alice ↔ Charlie
  console.log('  Alice ↔ Charlie:');
  const aliceCharlieMessages: MessageDef[] = [
    {
      conversationId: CONV_ALICE_CHARLIE,
      senderId: charlie.userId,
      content: 'Alice ơi, cái socket.io bên backend đã hoạt động chưa?',
      offsetMs: -7200_000,
    },
    {
      conversationId: CONV_ALICE_CHARLIE,
      senderId: alice.userId,
      content: 'Rồi! Mình vừa test xong. Message real-time chạy ổn áp 💪',
      offsetMs: -7200_000 + 90_000,
    },
    {
      conversationId: CONV_ALICE_CHARLIE,
      senderId: charlie.userId,
      content: 'Tuyệt! Thế còn typing indicator?',
      offsetMs: -7200_000 + 180_000,
    },
    {
      conversationId: CONV_ALICE_CHARLIE,
      senderId: alice.userId,
      content: 'Cũng xong rồi, đang nhập thì thấy dấu 3 chấm nhấp nháy ngay',
      offsetMs: -7200_000 + 270_000,
    },
    {
      conversationId: CONV_ALICE_CHARLIE,
      senderId: charlie.userId,
      content: 'Perfect! Merge vào develop đi nhé',
      offsetMs: -7200_000 + 360_000,
    },
    {
      conversationId: CONV_ALICE_CHARLIE,
      senderId: alice.userId,
      content: 'Đang tạo PR rồi, bạn assign reviewer giúp mình nhé',
      offsetMs: -3600_000,
    },
    {
      conversationId: CONV_ALICE_CHARLIE,
      senderId: charlie.userId,
      content: 'Done, mình sẽ review trong chiều nay',
      offsetMs: -3600_000 + 120_000,
    },
    {
      conversationId: CONV_ALICE_CHARLIE,
      senderId: alice.userId,
      content: 'Cảm ơn Charlie! Hôm nay productive quá 😄',
      offsetMs: -1200_000,
    },
  ];

  for (const msg of aliceCharlieMessages) {
    await seedMessage(msg);
    process.stdout.write('.');
  }
  console.log(` ${aliceCharlieMessages.length} tin nhắn`);

  // Nhóm Dev
  console.log('  Nhóm Dev Zalogram:');
  const groupMessages: MessageDef[] = [
    {
      conversationId: CONV_GROUP,
      senderId: alice.userId,
      content: 'Chào mọi người! Mình vừa tạo nhóm để sync tiến độ dự án nhé 👋',
      offsetMs: -86400_000,
    },
    {
      conversationId: CONV_GROUP,
      senderId: bob.userId,
      content: 'Hello team! Backend đang khá ổn, chat module implement xong rồi',
      offsetMs: -86400_000 + 300_000,
    },
    {
      conversationId: CONV_GROUP,
      senderId: charlie.userId,
      content: 'Frontend cũng gần xong, đang kết nối với real API',
      offsetMs: -86400_000 + 600_000,
    },
    {
      conversationId: CONV_GROUP,
      senderId: diana.userId,
      content: 'Docker compose đã setup xong, mọi người có thể chạy local dễ dàng rồi',
      offsetMs: -86400_000 + 900_000,
    },
    {
      conversationId: CONV_GROUP,
      senderId: alice.userId,
      content: 'Good job team! Deadline còn 2 tuần, mình đang đúng tiến độ 🎯',
      offsetMs: -43200_000,
    },
    {
      conversationId: CONV_GROUP,
      senderId: bob.userId,
      content: 'Nhắc nhau: nhớ viết unit test cho chat service nhé',
      offsetMs: -43200_000 + 600_000,
    },
    {
      conversationId: CONV_GROUP,
      senderId: charlie.userId,
      content: 'Đang làm rồi Bob ơi 😅',
      offsetMs: -43200_000 + 900_000,
    },
    {
      conversationId: CONV_GROUP,
      senderId: diana.userId,
      content: 'CI/CD pipeline cũng cần test thật kỹ trước khi deploy production',
      offsetMs: -21600_000,
    },
    {
      conversationId: CONV_GROUP,
      senderId: alice.userId,
      content: 'Đồng ý, staging deploy trước. Ai có update gì thì thông báo nhóm nhé!',
      offsetMs: -10800_000,
    },
    {
      conversationId: CONV_GROUP,
      senderId: bob.userId,
      content: 'Backend v1 đã stable, sẵn sàng cho integration test 🔥',
      offsetMs: -3600_000,
    },
    {
      conversationId: CONV_GROUP,
      senderId: charlie.userId,
      content: 'Frontend build thành công không lỗi! Đang test trên Chrome/Firefox',
      offsetMs: -1800_000,
    },
    {
      conversationId: CONV_GROUP,
      senderId: diana.userId,
      content: 'Tốt lắm mọi người! Sprint này xịn 🚀',
      offsetMs: -600_000,
    },
  ];

  for (const msg of groupMessages) {
    await seedMessage(msg);
    process.stdout.write('.');
  }
  console.log(` ${groupMessages.length} tin nhắn`);

  // 4. Summary
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║   Seed hoàn tất!                     ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('\nTài khoản đăng nhập (mật khẩu chung: Test@1234):');
  console.log('──────────────────────────────────────────────');
  for (const u of users) {
    console.log(`  ${u.displayName.padEnd(18)} │ ${u.email}`);
  }
  console.log('\nConversation IDs:');
  console.log(`  Alice ↔ Bob       │ ${CONV_ALICE_BOB}`);
  console.log(`  Alice ↔ Charlie   │ ${CONV_ALICE_CHARLIE}`);
  console.log(`  Nhóm Dev Zalogram │ ${CONV_GROUP}`);
  console.log('\nHướng dẫn test:');
  console.log('  1. Đăng nhập bằng tài khoản alice@zalogram.test / Test@1234');
  console.log('  2. Mở trang Chat → sẽ thấy các hội thoại đã seed');
  console.log('  3. Mở tab khác đăng nhập bob@zalogram.test để test real-time');
  console.log('  4. Gửi tin nhắn từ một tab, tab kia sẽ nhận ngay qua socket\n');
}

main().catch((err: unknown) => {
  console.error('\n[ERROR] Seed thất bại:', err);
  process.exit(1);
});
