from __future__ import annotations

import os
from typing import Any
from urllib.parse import quote

import requests


NTFY_DEFAULT_BASE_URL = "https://ntfy.sh"
NTFY_DEFAULT_TOPIC = "Wordbee33"
NTFY_DEFAULT_ADMIN_TOPIC = "Wordbee33ADMIN"
NTFY_DEFAULT_TITLE = "Wordbee"
NTFY_TIMEOUT_SECONDS = 8
TRUTHY_VALUES = {"1", "true", "yes", "on"}


def publish_completion_notification(
    *,
    board: list[list[str]],
    friends_family_identity: object,
    guesses_used: int,
) -> dict[str, Any]:
    canonical_name = get_friends_family_display_name(friends_family_identity)
    if not canonical_name:
        return {"sent": False, "reason": "not_friends_family"}

    message = create_completion_message(canonical_name, guesses_used, board)
    return publish_ntfy_message(
        message=message,
        topic=get_ntfy_topic("WORDBEE_NTFY_TOPIC", NTFY_DEFAULT_TOPIC),
    )


def publish_contact_notification(
    *,
    message: str,
    first_name: str = "",
    last_initial: str = "",
) -> dict[str, Any]:
    return publish_ntfy_message(
        message=create_contact_message(
            message=message,
            first_name=first_name,
            last_initial=last_initial,
        ),
        topic=get_ntfy_topic("WORDBEE_NTFY_ADMIN_TOPIC", NTFY_DEFAULT_ADMIN_TOPIC),
    )


def publish_ntfy_message(*, message: str, topic: str) -> dict[str, Any]:
    if not env_enabled("WORDBEE_NTFY_ENABLED"):
        return {"sent": False, "reason": "disabled"}

    if env_enabled("WORDBEE_NTFY_DRY_RUN"):
        return {"sent": False, "reason": "dry_run", "message": message, "topic": topic}

    if not topic:
        return {"sent": False, "reason": "missing_topic"}

    base_url = os.environ.get("WORDBEE_NTFY_BASE_URL", NTFY_DEFAULT_BASE_URL).strip()
    url = f"{base_url.rstrip('/')}/{quote(topic, safe='')}"
    title = os.environ.get("WORDBEE_NTFY_TITLE", NTFY_DEFAULT_TITLE).strip()
    headers = {"Content-Type": "text/plain; charset=utf-8"}
    token = os.environ.get("WORDBEE_NTFY_TOKEN", "").strip()

    headers["Title"] = title or NTFY_DEFAULT_TITLE

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
        f"{display_name} completed today's Wordle in {format_guess_count(guesses_used)}\n"
        f"{create_emoji_grid(board)}"
    )


def create_contact_message(*, message: str, first_name: str, last_initial: str) -> str:
    sender = create_contact_sender_name(first_name=first_name, last_initial=last_initial)
    return f"Suggestion from {sender}:\n{message.strip()}"


def create_contact_sender_name(*, first_name: str, last_initial: str) -> str:
    cleaned_first_name = normalize_display_name(first_name)
    cleaned_last_initial = normalize_last_initial(last_initial)

    if cleaned_first_name and cleaned_last_initial:
        return f"{cleaned_first_name} {cleaned_last_initial}"

    if cleaned_first_name:
        return cleaned_first_name

    return "Guest"


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


def get_friends_family_display_name(friends_family_identity: object) -> str:
    if not isinstance(friends_family_identity, dict):
        return ""

    if friends_family_identity.get("kind") != "friends-family":
        return ""

    return normalize_display_name(friends_family_identity.get("displayName"))


def normalize_display_name(display_name: object) -> str:
    if not isinstance(display_name, str):
        return ""

    return " ".join(display_name.strip().split())[:64]


def normalize_last_initial(last_initial: object) -> str:
    if not isinstance(last_initial, str):
        return ""

    return last_initial.strip()[:1].upper()


def get_ntfy_topic(key: str, default_topic: str) -> str:
    return os.environ.get(key, default_topic).strip()


def env_enabled(key: str) -> bool:
    return os.environ.get(key, "").strip().casefold() in TRUTHY_VALUES
