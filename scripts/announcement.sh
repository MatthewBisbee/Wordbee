#!/usr/bin/env bash

# Sends a one-day Wordbee announcement by writing the static frontend config.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_LOCAL_DIR="${SCRIPT_DIR}/../frontend/public"
WEBROOT_DIR="${WEBROOT_DIR:-/var/www/html}"
CONFIG_FILE="${WEBROOT_DIR}/announcement.json"
TIMEZONE="${WORDBEE_ANNOUNCEMENT_TIMEZONE:-America/Chicago}"

if [ ! -d "$WEBROOT_DIR" ] && [ -d "$DEFAULT_LOCAL_DIR" ]; then
    CONFIG_FILE="${DEFAULT_LOCAL_DIR}/announcement.json"
fi

function show_help() {
    echo "Usage: $0 \"message to show\""
    echo "       $0 --clear"
    echo "Set WEBROOT_DIR to the deployed frontend directory if it is not /var/www/html."
}

if [ "$#" -lt 1 ]; then
    show_help
    exit 1
fi

if [ "$1" = "--clear" ]; then
    mkdir -p "$(dirname "$CONFIG_FILE")"
    python3 - "$CONFIG_FILE" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
path.write_text(json.dumps({"active": False}, indent=2) + "\n", encoding="utf-8")
PY
    echo "Announcement cleared."
    exit 0
fi

MESSAGE="$*"

mkdir -p "$(dirname "$CONFIG_FILE")"
python3 - "$CONFIG_FILE" "$MESSAGE" "$TIMEZONE" <<'PY'
import json
import sys
from datetime import datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

path = Path(sys.argv[1])
message = " ".join(sys.argv[2].split())
timezone_name = sys.argv[3]

if not message:
    raise SystemExit("Message cannot be empty.")

try:
    timezone = ZoneInfo(timezone_name)
except ZoneInfoNotFoundError:
    timezone = datetime.now().astimezone().tzinfo

now = datetime.now(timezone)
tomorrow = now.date() + timedelta(days=1)
expires_at = datetime.combine(tomorrow, time.min, timezone)

payload = {
    "active": True,
    "id": now.strftime("%Y-%m-%d-%H%M%S"),
    "date": now.date().isoformat(),
    "message": message,
    "signature": "Matthew",
    "createdAt": now.isoformat(),
    "expiresAt": expires_at.isoformat(),
}

path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY

echo "Announcement sent for today and will expire at local midnight."
