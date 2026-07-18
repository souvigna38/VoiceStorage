#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${1:-$PROJECT_DIR/.env.macbook}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing environment file: $ENV_FILE"
  echo "Create it with: cp .env.macbook.example .env.macbook"
  exit 1
fi

if ! docker info > /dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop and try again."
  exit 1
fi

mkdir -p "$PROJECT_DIR/photo-inbox/processed"

docker compose \
  --env-file "$ENV_FILE" \
  -f "$PROJECT_DIR/docker-compose.macbook.yml" \
  up -d --build

APP_PORT="$(
  awk -F= '/^VOICESTORAGE_APP_PORT=/{print $2}' "$ENV_FILE" | tail -n 1
)"
MINIO_CONSOLE_PORT="$(
  awk -F= '/^VOICESTORAGE_MINIO_CONSOLE_PORT=/{print $2}' "$ENV_FILE" | tail -n 1
)"

echo ""
echo "VoiceStorage is starting."
echo "  App:           http://localhost:${APP_PORT:-3100}"
echo "  MinIO console: http://localhost:${MINIO_CONSOLE_PORT:-9101}"
echo ""
echo "Check status:"
echo "  docker compose --env-file \"$ENV_FILE\" -f \"$PROJECT_DIR/docker-compose.macbook.yml\" ps"
