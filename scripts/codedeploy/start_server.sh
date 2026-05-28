#!/usr/bin/env bash
set -euo pipefail

export PATH="/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin:$PATH"

DEPLOY_DIR="/opt/hamtech/backend-deploy"
cd "${DEPLOY_DIR}"

log_disk_usage() {
  local label="$1"

  echo "== Disk usage: ${label} =="
  df -h /
  docker system df || true
}

cleanup_docker_space() {
  echo "Cleaning unused Docker containers, images and build cache..."
  docker container prune -f
  docker image prune -af
  docker builder prune -af
}

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

log_disk_usage "before cleanup"
cleanup_docker_space
log_disk_usage "after cleanup"

docker compose -f docker-compose.prod.yml pull app

echo "Running database migrations..."
docker compose -f docker-compose.prod.yml run --rm --no-deps app npm run db:migrate:dist

docker compose -f docker-compose.prod.yml up -d --remove-orphans
docker image prune -af
log_disk_usage "after deploy"
