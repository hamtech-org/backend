#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="/opt/hamtech/backend-deploy"

cd "${DEPLOY_DIR}"

# Keep scripts executable after artifact extraction.
chmod +x scripts/codedeploy/*.sh
