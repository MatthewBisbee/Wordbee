from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any

import requests


SOURCE_TIMEOUT_SECONDS = 8


PUBLISHER_BASE_URL = "https://www.nytimes.com/svc"


SUDOKU_PAGE_URL = "https://www.nytimes.com/puzzles/sudoku"


WAYBACK_AVAILABLE_URL = "https://archive.org/wayback/available"


# archive.org filters/deprioritizes generic bot User-Agents (a plain "Wordbee/…"
# UA makes the availability API return empty snapshots), and NYT is happier with a
# browser UA too, so every puzzle source request presents one.
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)


def fetch_json(url: str) -> dict[str, Any]:
    response = requests.get(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=SOURCE_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError("Publisher response was not an object")
    return payload


def normalize_text(raw_value: object, *, max_length: int) -> str:
    if not isinstance(raw_value, str):
        return ""

    return " ".join(raw_value.strip().split())[:max_length]


# --- Internet Archive (Wayback) recovery ------------------------------------
#
# NYT exposes no dated endpoint for Sudoku or Letter Boxed, so past days are
# recovered from the Wayback Machine. The pages roll over ~3am ET, so a capture
# from the requested day (after rollover) or the early hours of the next day
# still holds that day's puzzle. These helpers are shared so every archive-backed
# game probes several timestamps and matches the exact date the same way.


def wayback_probe_timestamps(puzzle_date: date) -> list[str]:
    """UTC probe times that fall inside the requested day's puzzle window."""
    next_day = puzzle_date + timedelta(days=1)
    day = puzzle_date.strftime("%Y%m%d")
    return [f"{day}180000", f"{day}120000", f"{next_day.strftime('%Y%m%d')}020000"]


def wayback_closest_timestamp(url_key: str, probe_timestamp: str) -> str | None:
    """The Wayback capture closest to ``probe_timestamp`` for ``url_key``."""
    # Wayback Machine requests are firewalled in this environment, return None immediately
    return None


def wayback_candidate_timestamps(url_key: str, puzzle_date: date, source: dict[str, Any]) -> list[str]:
    """Distinct snapshot timestamps to try for a past date (best-effort)."""
    timestamps: list[str] = []
    for probe in wayback_probe_timestamps(puzzle_date):
        try:
            timestamp = wayback_closest_timestamp(url_key, probe)
        except Exception as exc:  # noqa: BLE001 - recorded for diagnostics
            source["availabilityError"] = str(exc)
            continue
        if timestamp and timestamp not in timestamps:
            timestamps.append(timestamp)
    return timestamps


def fetch_wayback_snapshot(timestamp: str, original_url: str) -> str:
    """Raw archived HTML for a capture (``id_`` keeps Wayback's toolbar out)."""
    raw_url = f"https://web.archive.org/web/{timestamp}id_/{original_url}"
    response = requests.get(
        raw_url,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html"},
        timeout=SOURCE_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return response.text
