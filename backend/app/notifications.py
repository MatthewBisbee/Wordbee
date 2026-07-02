from __future__ import annotations

import os
from typing import Any
from urllib.parse import quote

import requests


NTFY_DEFAULT_BASE_URL = "https://ntfy.sh"
NTFY_TIMEOUT_SECONDS = 8
TRUTHY_VALUES = {"1", "true", "yes", "on"}


def publish_completion_notification(
    *,
    board: list[list[str]],
    display_name: object,
    guesses_used: int,
) -> dict[str, Any]:
    canonical_name = get_allowed_family_name(display_name)
    if canonical_name is None:
        return {"sent": False, "reason": "not_family"}

    if not env_enabled("WORDBEE_NTFY_ENABLED"):
        return {"sent": False, "reason": "disabled"}

    message = create_completion_message(canonical_name, guesses_used, board)
    if env_enabled("WORDBEE_NTFY_DRY_RUN"):
        return {"sent": False, "reason": "dry_run", "message": message}

    topic = os.environ.get("WORDBEE_NTFY_TOPIC", "").strip()
    if not topic:
        return {"sent": False, "reason": "missing_topic"}

    base_url = os.environ.get("WORDBEE_NTFY_BASE_URL", NTFY_DEFAULT_BASE_URL).strip()
    url = f"{base_url.rstrip('/')}/{quote(topic, safe='')}"
    title = os.environ.get("WORDBEE_NTFY_TITLE", "").strip()
    headers = {"Content-Type": "text/plain; charset=utf-8"}
    token = os.environ.get("WORDBEE_NTFY_TOKEN", "").strip()

    if title:
        headers["Title"] = title

    if token:
        headers["Authorization"] = f"Bearer {token}"

    try:
        response = requests.post(
            url,
            data=message.encode("utf-8"),
            headers=headers,
            timeout=NTFY_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        return {"sent": False, "reason": "request_failed", "error": str(exc)}

    return {"sent": True, "reason": "sent"}


def create_completion_message(
    display_name: str,
    guesses_used: int,
    board: list[list[str]],
) -> str:
    return (
        f"{display_name} completed todays Wordbee in {format_guess_count(guesses_used)}\n"
        f"{create_emoji_grid(board)}"
    )


def create_emoji_grid(board: list[list[str]]) -> str:
    rows = []

    for row in board:
        rows.append(
            "".join(
                "🟩" if state == "correct" else "🟨" if state == "present" else "⬜"
                for state in row
            )
        )

    return "\n".join(rows)


def format_guess_count(guesses_used: int) -> str:
    return f"{guesses_used} {'guess' if guesses_used == 1 else 'guesses'}"


def get_allowed_family_name(display_name: object) -> str | None:
    requested_name = normalize_display_name(display_name)
    requested_key = member_key(requested_name)

    if not requested_key:
        return None

    for raw_name in os.environ.get("WORDBEE_FAMILY_MEMBERS", "").split(","):
        canonical_name = normalize_display_name(raw_name)

        if member_key(canonical_name) == requested_key:
            return canonical_name

    return None


def normalize_display_name(display_name: object) -> str:
    if not isinstance(display_name, str):
        return ""

    return " ".join(display_name.strip().split())[:64]


def member_key(display_name: str) -> str:
    return normalize_display_name(display_name).replace(".", "").casefold()


def env_enabled(key: str) -> bool:
    return os.environ.get(key, "").strip().casefold() in TRUTHY_VALUES
