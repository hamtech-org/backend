#!/usr/bin/env bash
set -euo pipefail

HEALTH_URL="http://localhost/health"
DEPLOY_DIR="/opt/hamtech/backend-deploy"

for i in {1..20}; do
  if curl -fsS "${HEALTH_URL}" >/dev/null; then
    echo "Health check passed"
    if [[ "${RUN_ES_SYNC_ON_DEPLOY:-true}" == "true" ]]; then
      echo "Running users -> Elasticsearch sync in app container"
      cd "${DEPLOY_DIR}"
      if ! docker compose -f docker-compose.prod.yml exec -T app node dist/scripts/database/sync-users-to-es.js; then
        echo "WARNING: users sync failed, continuing deployment"
      fi
    else
      echo "Skipping users sync on deploy (RUN_ES_SYNC_ON_DEPLOY=${RUN_ES_SYNC_ON_DEPLOY:-false})"
    fi
    exit 0
  fi
  sleep 5
done

echo "Health check failed"
exit 1
