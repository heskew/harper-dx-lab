#!/usr/bin/env bash
set -euo pipefail

# lab-teardown.sh — Safely tear down a worker, preserving artifacts
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
WORKER_ID="${1:?Usage: lab-teardown.sh <worker-id>}"

COMPONENT_DIR="${PROJECT_DIR}/.workers/worker-${WORKER_ID}/components"
ARCHIVE_DIR="${PROJECT_DIR}/.workers/worker-${WORKER_ID}/archive"

# Archive component files before teardown
if [ -d "$COMPONENT_DIR" ] && [ "$(ls -A "$COMPONENT_DIR" 2>/dev/null)" ]; then
    mkdir -p "$ARCHIVE_DIR"
    cp -r "$COMPONENT_DIR" "$ARCHIVE_DIR/components-$(date +%Y%m%d-%H%M%S)"
    echo "Archived components to $ARCHIVE_DIR"
else
    echo "WARNING: No component files found in $COMPONENT_DIR"
fi

# Stop the stack
COMPOSE_PROJECT="dx-lab-worker-${WORKER_ID}"
docker compose \
    -f "${SCRIPT_DIR}/docker-compose.worker.yml" \
    -p "${COMPOSE_PROJECT}" \
    down -v

echo "Worker ${WORKER_ID} torn down. Archives in $ARCHIVE_DIR"
