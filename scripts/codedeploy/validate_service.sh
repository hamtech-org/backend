#!/usr/bin/env bash
set -euo pipefail

HEALTH_URL="http://localhost/health"

for i in {1..20}; do
  if curl -fsS "${HEALTH_URL}" >/dev/null; then
    echo "Health check passed"
    exit 0
  fi
  sleep 5
done

echo "Health check failed"
exit 1
