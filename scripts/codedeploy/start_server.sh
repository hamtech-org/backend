#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="/opt/hamtech/backend-deploy"
cd "${DEPLOY_DIR}"

if [[ ! -f imageDetail.json ]]; then
  echo "imageDetail.json not found"
  exit 1
fi

ECR_IMAGE="$(python3 -c "import json;print(json.load(open('imageDetail.json'))['ImageURI'])")"

if [[ -z "${ECR_IMAGE}" ]]; then
  echo "ImageURI is empty"
  exit 1
fi

ECR_REGISTRY="$(echo "${ECR_IMAGE}" | cut -d'/' -f1)"
AWS_REGION="$(echo "${ECR_REGISTRY}" | cut -d'.' -f4)"

if [[ -z "${AWS_REGION}" ]]; then
  echo "Cannot resolve AWS region from image URI: ${ECR_IMAGE}"
  exit 1
fi

aws ecr get-login-password --region "${AWS_REGION}" \
  | docker login --username AWS --password-stdin "${ECR_REGISTRY}"

export ECR_REPO_WITH_TAG="${ECR_IMAGE}"

docker compose -f docker-compose.prod.yml pull

echo "Running database migrations..."
docker compose -f docker-compose.prod.yml run --rm app npm run db:migrate

docker compose -f docker-compose.prod.yml up -d --remove-orphans
docker image prune -f
