#!/bin/sh
set -e

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   Zalogram Backend — Startup         ║"
echo "╚══════════════════════════════════════╝"
echo ""

echo "[1/5] Installing dependencies..."
npm install --prefer-offline --no-audit 2>&1 | tail -1
echo ""

echo "[2/5] Waiting for DynamoDB..."
npx tsx scripts/database/wait-for-dynamodb.ts
echo ""

echo "[3/5] Initializing tables..."
npx tsx scripts/database/setup-database.ts
echo ""

echo "[4/5] Seeding data..."
npx tsx scripts/database/insert-data.ts
echo ""

echo "[5/5] Starting dev server..."
exec npm run dev
