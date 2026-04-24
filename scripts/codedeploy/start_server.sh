#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="/opt/hamtech/backend-deploy"
cd "${DEPLOY_DIR}"

if [[ ! -f imageDetail.json ]]; then
  echo "imageDetail.json not found"
  exit 1
fi

ECR_IMAGE="$(node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync('imageDetail.json','utf8'));process.stdout.write(d.ImageURI||'')")"

if [[ -z "${ECR_IMAGE}" ]]; then
  echo "ImageURI is empty"
  exit 1
fi

export ECR_REPO_WITH_TAG="${ECR_IMAGE}"

docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --remove-orphans
docker image prune -f
