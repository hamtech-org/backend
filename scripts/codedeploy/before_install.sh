#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="/opt/hamtech/backend-deploy"

mkdir -p "${DEPLOY_DIR}"

# Ensure Docker is reachable for deployment commands.
docker info >/dev/null
