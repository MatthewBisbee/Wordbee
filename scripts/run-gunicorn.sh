#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
GUNICORN_BIN="${GUNICORN_BIN:-${PROJECT_ROOT}/.venv/bin/gunicorn}"

cd "$PROJECT_ROOT"

exec "$GUNICORN_BIN" \
  --chdir "${PROJECT_ROOT}/backend" \
  --bind "${WORDBEE_BIND:-127.0.0.1:5001}" \
  --workers "${WORDBEE_WORKERS:-2}" \
  --threads "${WORDBEE_THREADS:-4}" \
  --timeout "${WORDBEE_TIMEOUT:-90}" \
  --access-logfile "-" \
  --error-logfile "-" \
  run:app
