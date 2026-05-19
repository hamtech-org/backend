#!/bin/sh
set -e

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   Zalogram Backend — Startup         ║"
echo "╚══════════════════════════════════════╝"
echo ""

if ! command -v ffprobe >/dev/null 2>&1; then
  echo "[0/6] Installing ffmpeg..."
  apk add --no-cache ffmpeg >/dev/null
  echo ""
fi

echo "[1/5] Installing dependencies..."
npm install --prefer-offline --no-audit 2>&1 | tail -1
echo ""

echo "[2/5] Waiting for DynamoDB..."
npx tsx scripts/database/wait-for-dynamodb.ts
echo ""

echo "[3/5] Initializing tables..."
npx tsx scripts/database/setup-database.ts
echo ""

# echo "[4/5] Seeding data..."
# npx tsx scripts/database/insert-data.ts
# echo ""

echo "[4/5] Waiting for Elasticsearch..."
npx tsx scripts/database/wait-for-elasticsearch.ts
echo ""

echo "[5/5] Syncing users to Elasticsearch..." 
npx tsx scripts/database/sync-users-to-es.ts
echo ""

echo "[6/6] Syncing messages to Elasticsearch..."
npx tsx scripts/database/backfill-messages-to-es.ts
echo ""

echo "[6/6] Starting dev server..."
exec npm run dev
