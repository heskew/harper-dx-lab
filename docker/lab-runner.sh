#!/usr/bin/env bash
set -euo pipefail

# lab-runner.sh — Spawn an isolated Docker environment for a DX Lab worker
#
# Usage:
#   ./docker/lab-runner.sh --tier 1 --harper-version 5.0.0-alpha.3 --worker-id 1 --expert-iteration 0
#
# This script:
#   1. Creates a Docker Compose stack with isolated Harper + workspace
#   2. Waits for Harper to be healthy
#   3. Prints connection info for the agent

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Defaults
TIER=""
HARPER_VERSION=""
WORKER_ID=""
EXPERT_ITERATION="0"
BASE_REST_PORT=19926
BASE_OPS_PORT=19925

usage() {
    echo "Usage: $0 --tier N --harper-version VERSION --worker-id N [--expert-iteration N]"
    echo ""
    echo "Options:"
    echo "  --tier              Tier number (1-6)"
    echo "  --harper-version    Harper Docker image tag (e.g., 5.0.0-alpha.3)"
    echo "  --worker-id         Worker number (used for port offsets and naming)"
    echo "  --expert-iteration  Expert knowledge iteration (default: 0)"
    exit 1
}

# Parse args
while [[ $# -gt 0 ]]; do
    case $1 in
        --tier) TIER="$2"; shift 2 ;;
        --harper-version) HARPER_VERSION="$2"; shift 2 ;;
        --worker-id) WORKER_ID="$2"; shift 2 ;;
        --expert-iteration) EXPERT_ITERATION="$2"; shift 2 ;;
        -h|--help) usage ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
done

# Validate
[[ -z "$TIER" ]] && echo "Error: --tier required" && usage
[[ -z "$HARPER_VERSION" ]] && echo "Error: --harper-version required" && usage
[[ -z "$WORKER_ID" ]] && echo "Error: --worker-id required" && usage

# Compute ports (each worker gets unique ports)
REST_PORT=$((BASE_REST_PORT + WORKER_ID))
OPS_PORT=$((BASE_OPS_PORT + WORKER_ID))

# Determine assignment file
ASSIGNMENT_FILE="tier-${TIER}-bookmark-manager.md"
if [[ ! -f "${PROJECT_DIR}/assignments/${ASSIGNMENT_FILE}" ]]; then
    # Try to find any tier-N assignment
    ASSIGNMENT_FILE=$(ls "${PROJECT_DIR}/assignments/tier-${TIER}-"*.md 2>/dev/null | head -1 | xargs basename 2>/dev/null || true)
    if [[ -z "$ASSIGNMENT_FILE" ]]; then
        echo "Error: No assignment found for tier ${TIER} in ${PROJECT_DIR}/assignments/"
        exit 1
    fi
fi

COMPOSE_PROJECT="dx-lab-worker-${WORKER_ID}"

echo "═══════════════════════════════════════════════════════════"
echo "  DX Lab Worker ${WORKER_ID}"
echo "  Tier: ${TIER} | Harper: ${HARPER_VERSION} | Expert iter: ${EXPERT_ITERATION}"
echo "  Assignment: ${ASSIGNMENT_FILE}"
echo "═══════════════════════════════════════════════════════════"

# Pull Harper image if not present
echo "Pulling Harper image..."
docker pull "harperdb/harperdb:${HARPER_VERSION}" 2>/dev/null || {
    echo "Warning: Could not pull harperdb/harperdb:${HARPER_VERSION}"
    echo "Using local image if available."
}

# Start the stack
echo "Starting Docker stack..."
HARPER_VERSION="${HARPER_VERSION}" \
WORKER_ID="${WORKER_ID}" \
HARPER_REST_PORT="${REST_PORT}" \
HARPER_OPS_PORT="${OPS_PORT}" \
ASSIGNMENT_FILE="${ASSIGNMENT_FILE}" \
docker compose \
    -f "${SCRIPT_DIR}/docker-compose.worker.yml" \
    -p "${COMPOSE_PROJECT}" \
    up -d

# Wait for Harper to be healthy
echo "Waiting for Harper to be ready..."
RETRIES=30
while [[ $RETRIES -gt 0 ]]; do
    if curl -sf "http://localhost:${REST_PORT}/" > /dev/null 2>&1; then
        echo "Harper is ready!"
        break
    fi
    RETRIES=$((RETRIES - 1))
    sleep 2
done

if [[ $RETRIES -eq 0 ]]; then
    echo "Error: Harper did not become healthy within 60 seconds"
    docker compose -f "${SCRIPT_DIR}/docker-compose.worker.yml" -p "${COMPOSE_PROJECT}" logs harper
    exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Worker ${WORKER_ID} is running"
echo ""
echo "  Harper REST:  http://localhost:${REST_PORT}"
echo "  Harper Ops:   http://localhost:${OPS_PORT}"
echo "  Assignment:   ${ASSIGNMENT_FILE}"
echo ""
echo "  To connect to workspace:"
echo "    docker exec -it ${COMPOSE_PROJECT}-workspace-1 bash"
echo ""
echo "  To stop:"
echo "    docker compose -f ${SCRIPT_DIR}/docker-compose.worker.yml -p ${COMPOSE_PROJECT} down -v"
echo "═══════════════════════════════════════════════════════════"
