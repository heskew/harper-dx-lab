#!/usr/bin/env bash
set -euo pipefail

# lab-runner.sh — Spawn an isolated Docker environment for a DX Lab worker
#
# Usage:
#   ./docker/lab-runner.sh --tier 1 --harper-image harperdb:v5-local --worker-id 1
#   ./docker/lab-runner.sh --tier 1 --harper-version 4.7.19 --worker-id 1
#
# This script:
#   1. Creates a Docker Compose stack with isolated Harper + workspace
#   2. Waits for Harper to be healthy
#   3. Prints connection info for the agent

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Defaults
TIER=""
HARPER_IMAGE=""
WORKER_ID=""
EXPERT_ITERATION="0"
BASE_REST_PORT=19926
BASE_OPS_PORT=19925

usage() {
    echo "Usage: $0 --tier N --harper-image IMAGE --worker-id N [--expert-iteration N]"
    echo ""
    echo "Options:"
    echo "  --tier              Tier number (1-6)"
    echo "  --harper-image      Full Docker image (e.g., harperdb:v5-local or harperdb/harperdb:4.7.19)"
    echo "  --worker-id         Worker number (used for port offsets and naming)"
    echo "  --expert-iteration  Expert knowledge iteration (default: 0)"
    echo ""
    echo "  Legacy: --harper-version VERSION (converted to harperdb/harperdb:VERSION)"
    exit 1
}

# Parse args
while [[ $# -gt 0 ]]; do
    case $1 in
        --tier) TIER="$2"; shift 2 ;;
        --harper-image) HARPER_IMAGE="$2"; shift 2 ;;
        --harper-version) HARPER_IMAGE="harperdb/harperdb:$2"; shift 2 ;;
        --worker-id) WORKER_ID="$2"; shift 2 ;;
        --expert-iteration) EXPERT_ITERATION="$2"; shift 2 ;;
        -h|--help) usage ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
done

# Validate
[[ -z "$TIER" ]] && echo "Error: --tier required" && usage
[[ -z "$HARPER_IMAGE" ]] && echo "Error: --harper-image required" && usage
[[ -z "$WORKER_ID" ]] && echo "Error: --worker-id required" && usage

# Compute ports (each worker gets unique ports)
REST_PORT=$((BASE_REST_PORT + WORKER_ID * 2))
OPS_PORT=$((BASE_OPS_PORT + WORKER_ID * 2))
MQTT_PORT=$((11883 + WORKER_ID * 2))

# Determine assignment file
ASSIGNMENT_FILE="tier-${TIER}-bookmark-manager.md"
if [[ ! -f "${PROJECT_DIR}/assignments/${ASSIGNMENT_FILE}" ]]; then
    ASSIGNMENT_FILE=$(ls "${PROJECT_DIR}/assignments/tier-${TIER}-"*.md 2>/dev/null | head -1 | xargs basename 2>/dev/null || true)
    if [[ -z "$ASSIGNMENT_FILE" ]]; then
        echo "Error: No assignment found for tier ${TIER} in ${PROJECT_DIR}/assignments/"
        exit 1
    fi
fi

# Create per-worker component directory
COMPONENT_DIR="${PROJECT_DIR}/.workers/worker-${WORKER_ID}/components"
mkdir -p "$COMPONENT_DIR"

if [ "$(ls -A "$COMPONENT_DIR" 2>/dev/null)" ]; then
    ARCHIVE_DIR="${PROJECT_DIR}/.workers/worker-${WORKER_ID}/archive/$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$ARCHIVE_DIR"
    cp -r "$COMPONENT_DIR"/* "$ARCHIVE_DIR"/
    echo "Archived previous components to $ARCHIVE_DIR"
    rm -rf "${COMPONENT_DIR:?}"/*
fi

COMPOSE_PROJECT="dx-lab-worker-${WORKER_ID}"

echo "═══════════════════════════════════════════════════════════"
echo "  DX Lab Worker ${WORKER_ID}"
echo "  Tier: ${TIER} | Image: ${HARPER_IMAGE} | Expert iter: ${EXPERT_ITERATION}"
echo "  Assignment: ${ASSIGNMENT_FILE}"
echo "═══════════════════════════════════════════════════════════"

# Pull image only if remote (contains '/')
if [[ "$HARPER_IMAGE" == *"/"* ]]; then
    echo "Pulling Harper image..."
    docker pull "$HARPER_IMAGE" 2>/dev/null || {
        echo "Warning: Could not pull ${HARPER_IMAGE}"
        echo "Using local image if available."
    }
else
    echo "Using local image: ${HARPER_IMAGE}"
    if ! docker image inspect "$HARPER_IMAGE" > /dev/null 2>&1; then
        echo "Error: Local image ${HARPER_IMAGE} not found. Build it first."
        exit 1
    fi
fi

# Start the stack
echo "Starting Docker stack..."

# Usage of .env file from docker directory if it exists
ENV_FILE_OPT=""
if [[ -f "${SCRIPT_DIR}/.env" ]]; then
    ENV_FILE_OPT="--env-file ${SCRIPT_DIR}/.env"
fi

HARPER_IMAGE="${HARPER_IMAGE}" \
HARPER_REST_PORT="${REST_PORT}" \
HARPER_OPS_PORT="${OPS_PORT}" \
HARPER_MQTT_PORT="${MQTT_PORT}" \
COMPONENT_DIR="${COMPONENT_DIR}" \
ASSIGNMENT_FILE="${ASSIGNMENT_FILE}" \
docker compose \
    -f "${SCRIPT_DIR}/docker-compose.worker.yml" \
    ${ENV_FILE_OPT} \
    -p "${COMPOSE_PROJECT}" \
    up -d

# Wait for Harper to be healthy (HTTP in dev mode)
echo "Waiting for Harper to be ready..."
RETRIES=30
while [[ $RETRIES -gt 0 ]]; do
    if curl -so /dev/null "http://localhost:${OPS_PORT}/" 2>/dev/null; then
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
echo "  Harper REST:    http://localhost:${REST_PORT}"
echo "  Harper Ops:     http://localhost:${OPS_PORT}"
echo "  Harper MQTT:     http://localhost:${MQTT_PORT}"
echo "  Auth:           admin / password"
echo "  Components:     ${COMPONENT_DIR}"
echo "  Assignment:     ${ASSIGNMENT_FILE}"
echo ""
echo "  To connect to workspace:"
echo "    docker exec -it ${COMPOSE_PROJECT}-workspace-1 bash"
echo ""
echo "  To stop:"
echo "    docker compose -f ${SCRIPT_DIR}/docker-compose.worker.yml -p ${COMPOSE_PROJECT} down -v"
echo "═══════════════════════════════════════════════════════════"
