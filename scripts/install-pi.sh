#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "$PROJECT_ROOT"

python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r backend/requirements.txt

if [ ! -x .venv/bin/gunicorn ]; then
  echo "ERROR: .venv/bin/gunicorn is missing; backend/requirements.txt must include gunicorn." >&2
  exit 1
fi

.venv/bin/gunicorn --version >/dev/null

chmod +x scripts/*.sh

echo "Wordbee Python environment is ready at ${PROJECT_ROOT}/.venv"
