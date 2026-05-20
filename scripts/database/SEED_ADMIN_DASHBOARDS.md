# Seed dữ liệu demo — Admin Resources & Statistics

Tài liệu này mô tả cách **tự chạy** seed vào môi trường local để test hai trang:

- `/admin/resources` — Báo cáo tài nguyên (DynamoDB: `Media` + map từ `Messages`, `Posts`, `Reels`, `Users`)
- `/admin/statistics` — Thống kê (Elasticsearch: index `messages`, `posts`)

**Seed không chạy tự động** khi `docker-compose up` / `entrypoint.sh`. Mỗi thành viên trong team phải chạy lệnh thủ công nếu muốn có dữ liệu demo.

---

## Điều kiện

1. DynamoDB local: `DYNAMODB_ENDPOINT=http://localhost:8000` (trong `.env` backend)
2. Elasticsearch local đang chạy (cho trang Thống kê)
3. Backend API chạy tại `http://localhost:3000` (URL media trong seed trỏ về đây)
4. Đăng nhập tài khoản admin (ví dụ `admin@hamtech.local`)

---

## Bước 1 — Tạo bảng (nếu DB mới)

```bash
cd backend
npm run db:setup
```

---

## Bước 2 — Seed DynamoDB (báo cáo tài nguyên)

### Cách nhanh — gói demo admin (khuyến nghị)

Chạy **một lần** theo đúng thứ tự (Media → Users → Messages → Posts → Reels):

```bash
cd backend
npm run db:seed:admin-demo
```

### Cách từng file (khi chỉ cần cập nhật một bảng)

| Mục đích | File JSON | Lệnh |
|----------|-----------|------|
| Bản ghi Media (size, type, uploader) | `data/Media.json` | `npm run db:seed:media` |
| Avatar Alice trỏ media nội bộ | `data/Users.json` | `npm run db:seed:users` |
| Tin nhắn có `mediaUrl` (chat 1-1, nhóm) | `data/Messages.json` | `npm run db:seed:messages` |
| Bài viết có ảnh | `data/Posts.json` | `npm run db:seed:posts` |
| Reel video + thumbnail | `data/Reels.json` | `npm run db:seed:reels` |

Tương đương với flag `--file`:

```bash
npm run db:seed -- --file Media
npm run db:seed -- --file=Posts
```

**Lưu ý:** `insert-data.ts` dùng `Put` → ghi đè item theo `PK`/`SK`, **không xóa** item cũ không có trong JSON.

### Dữ liệu demo gồm gì?

| Nguồn (UI) | Nội dung seed |
|------------|----------------|
| Chat 1-1 | Tin ảnh Alice→Bob, media `...001` |
| Chat nhóm | Video + audio trong nhóm dev, media `...002`, `...003` |
| Bài viết | 2 post, media `...004`, `...005` |
| Reels | 1 reel, video `...006`, thumb `...007` |
| Avatar | Alice, media `...008` |
| Khác | File PDF general `...009` (không map từ entity khác) |

Tổng **13** file Media; dung lượng cố ý **≥ ~10 MB/file** để cột stacked (đơn vị GB, 2 chữ số thập phân) hiện đủ **ảnh / video / âm thanh / tệp khác**.

| Nguồn | Loại hiển thị trên stacked |
|-------|----------------------------|
| Chat nhóm | image + video + audio + file |
| Chat 1-1 | image + file |
| Bài viết | image + file |
| Reels | video + image (thumbnail) |
| Avatar | image |
| Khác | file (PDF không map entity) |

### Xem trên UI

1. Mở `http://localhost:5173/admin/resources`
2. Bấm **Tính lại** (hoặc `?refresh=1`) — cache RAM 5 phút
3. Thử bộ lọc **Nguồn** × **Loại**

---

## Bước 3 — Seed Elasticsearch (trang Thống kê)

Script **không ghi DynamoDB**, chỉ index mẫu vào ES:

```bash
cd backend
npm run es:seed:analytics
```

Tùy chỉnh khối lượng (mặc định: 600 tin, 80 bài, 7 ngày):

```bash
npm run es:seed:analytics -- --messages 800 --posts 120 --days 7
```

### Xem trên UI

1. Mở `http://localhost:5173/admin/statistics`
2. Chọn khoảng **7 ngày** (khớp `--days`)
3. Tab: Tin nhắn, Cao điểm, Nhóm chat, Bài viết

---

## Quy trình đầy đủ (copy-paste)

```bash
cd backend
npm run db:setup
npm run db:seed:admin-demo
npm run es:seed:analytics
```

Sau đó khởi động backend + frontend, đăng nhập admin, mở hai trang admin ở trên.

---

## Push lên Git — teammate cần làm gì?

1. `git pull` (nhận file JSON trong `scripts/database/data/`)
2. Chạy stack local (DynamoDB + ES)
3. Chạy các lệnh seed ở trên — **không** expect data có sẵn sau khi chỉ `docker-compose up`

`entrypoint.sh` hiện **comment** bước `insert-data.ts`. Các bước `sync-users-to-es` / `backfill-messages-to-es` chỉ đồng bộ dữ liệu **đã có** trong DynamoDB, không thay cho seed JSON hay `es:seed:analytics`.

---

## Reset / gỡ seed

- Ghi đè lại: chạy lại lệnh seed (cùng PK/SK)
- Xóa sạch DynamoDB in-memory: recreate container DynamoDB rồi `db:setup` + seed lại
- ES analytics: xóa index hoặc chạy lại `es:seed:analytics` (tạo thêm document mới)

---

## File liên quan

- `data/Media.json`, `Posts.json`, `Reels.json`, `Messages.json`, `Users.json`
- `insert-data.ts` — hỗ trợ `--file <TableName>`
- `seed-analytics-es.ts` — seed ES cho statistics
