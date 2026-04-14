# Database Scripts (DynamoDB)

Folder nay chua cac script khoi tao va seed du lieu cho DynamoDB local trong Zalogram backend.

## Muc tieu

- Tu dong khoi tao bang va seed data khi chay `docker-compose up`
- Dam bao idempotent: co the chay lai nhieu lan ma khong loi
- Tach du lieu seed ra JSON de team de bao tri

## Cau truc folder

- `wait-for-dynamodb.ts`
  - Poll DynamoDB endpoint den khi service san sang
  - Dung truoc cac buoc setup/seed
- `setup-database.ts`
  - Tao toan bo bang DynamoDB neu chua ton tai
  - Co cau hinh TTL cho mot so bang (`Sessions`, `Notifications`)
- `insert-data.ts`
  - Doc tat ca file `*.json` trong `data/`
  - Suy ra ten bang tu ten file: `Users.json` -> `${DYNAMODB_TABLE_PREFIX}Users`
  - Ghi du lieu bang `BatchWrite` (chunk 25 items), overwrite theo PK/SK
- `seed-data.ts`
  - Script legacy (hardcode data trong code)
  - Da deprecated, giu lai de tham khao
- `data/`
  - Chua seed data theo tung bang (moi file la 1 mang JSON)

## Danh sach file data

Tat ca file trong `data/`:

- `Users.json`
- `Sessions.json`
- `Conversations.json`
- `Messages.json`
- `MessageStatus.json`
- `MessageUserHide.json`
- `Contacts.json`
- `Groups.json`
- `Posts.json`
- `Reactions.json`
- `Comments.json`
- `Reels.json`
- `Notifications.json`
- `ModerationLogs.json`
- `Analytics.json`

## Quy tac data file

- Ten file phai khop ten bang (PascalCase)
- Moi file la JSON array:
  - Co du lieu: `[ { ...item1 }, { ...item2 } ]`
  - Khong co du lieu: `[]`
- Moi item can dung schema key cua bang (PK/SK va cac thuoc tinh lien quan)

## Startup sequence trong Docker

Duoc goi tu `scripts/entrypoint.sh`:

1. `npm install`
2. `npx tsx scripts/database/wait-for-dynamodb.ts`
3. `npx tsx scripts/database/setup-database.ts`
4. `npx tsx scripts/database/insert-data.ts`
5. `npm run dev`

## Lenh thu cong (manual)

Co the chay rieng tung buoc qua `package.json` scripts:

- `npm run db:wait`
- `npm run db:setup`
- `npm run db:seed`
- `npm run db:reset`
- `npm run db:seed:legacy` (chi dung khi can)

## Bien moi truong lien quan

- `DYNAMODB_ENDPOINT` (mac dinh: `http://localhost:8000`)
- `AWS_REGION` (mac dinh: `ap-southeast-1`)
- `DYNAMODB_TABLE_PREFIX` (mac dinh: `Zalogram_`)
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (local fallback: `local`)

## Luu y quan trong

- `insert-data.ts` overwrite item theo key, nhung khong xoa item cu khong co trong JSON
- Neu DynamoDB chay `-inMemory`, data se mat khi container bi recreate
- Muon reset ve trang thai seed, dung `npm run db:reset` hoac restart lai stack theo workflow hien tai
