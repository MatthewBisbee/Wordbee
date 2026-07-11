#!/usr/bin/env bash

# Wordbee maintenance mode toggle.
# Updates the frontend maintenance config served by nginx.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WEBROOT_DIR="${WEBROOT_DIR:-${PROJECT_ROOT}/frontend/dist}"

CONFIG_FILE="${WEBROOT_DIR}/maintenance.json"

function show_help() {
    echo "Usage: $0 <game_key> <on|off>"
    echo "Example: $0 connections on"
    echo "This will disable/gray out 'connections' by adding it to $CONFIG_FILE."
}

if [ "$#" -ne 2 ]; then
    show_help
    exit 1
fi

GAME_KEY=$(echo "$1" | tr '[:upper:]' '[:lower:]')
ACTION=$(echo "$2" | tr '[:upper:]' '[:lower:]')

mkdir -p "$WEBROOT_DIR"

if [ "$ACTION" = "on" ]; then
    python3 - "$CONFIG_FILE" "$GAME_KEY" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
game = sys.argv[2]
try:
    data = json.loads(path.read_text(encoding="utf-8"))
except (FileNotFoundError, json.JSONDecodeError):
    data = {}

disabled = data.get("disabledGames")
if not isinstance(disabled, list):
    disabled = []
data["disabledGames"] = sorted({str(item) for item in disabled} | {game})
path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
    echo "Maintenance mode enabled for '$GAME_KEY'. It will now be grayed out."
elif [ "$ACTION" = "off" ]; then
    python3 - "$CONFIG_FILE" "$GAME_KEY" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
game = sys.argv[2]
try:
    data = json.loads(path.read_text(encoding="utf-8"))
except (FileNotFoundError, json.JSONDecodeError):
    data = {}

disabled = data.get("disabledGames")
if not isinstance(disabled, list):
    disabled = []
data["disabledGames"] = [str(item) for item in disabled if str(item) != game]
path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
    echo "Maintenance mode disabled for '$GAME_KEY'. It is now active."
else
    echo "Error: Invalid action '$ACTION'."
    show_help
    exit 1
fi
