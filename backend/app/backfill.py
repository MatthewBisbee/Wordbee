"""Bulk download of every available past puzzle into the local database.

Playback already reads from the per-game caches (``daily_answers``,
``daily_connections``, ``daily_strands``, ``daily_sudoku``, and the separate
``letterboxed.sqlite``), so once those are fully populated the app never needs
its upstream sources again. This module walks every date for every game and
fills those caches, recording coverage in ``archive_status`` so a run is
resumable and gaps can be re-attempted later.
"""
from __future__ import annotations

import time
from collections import Counter
from datetime import date, datetime, timedelta
from typing import Any, Callable

from .daily_answer import FIRST_OFFICIAL_PUZZLE_DATE, get_daily_answer, get_puzzle_date
from .db import connect
from .games.registry import GAME_KEYS, get_game_first_date, get_public_puzzle


# Wordle plus the registry games, in a stable order.
ARCHIVE_GAME_KEYS: list[str] = ["wordle", *sorted(GAME_KEYS)]

# These have no dated NYT endpoint and are recovered from the Internet Archive,
# which rate-limits; they get gentler pacing and an adaptive cooldown.
WAYBACK_GAMES = {"sudoku", "letterboxed"}

ProgressCallback = Callable[[str, date, str, str], None]


def archive_first_date(game_key: str) -> date:
    if game_key == "wordle":
        return FIRST_OFFICIAL_PUZZLE_DATE
    return get_game_first_date(game_key)


def backfill_game(
    game_key: str,
    *,
    start: date | None = None,
    end: date | None = None,
    pace_seconds: float = 1.5,
    force: bool = False,
    on_progress: ProgressCallback | None = None,
) -> Counter:
    """Download every puzzle for one game between ``start`` and ``end`` (inclusive)."""
    if game_key not in ARCHIVE_GAME_KEYS:
        raise ValueError(f"Unknown game: {game_key}")

    first = archive_first_date(game_key)
    current = max(start or first, first)
    last = end or get_puzzle_date()
    counts: Counter = Counter()
    consecutive_failures = 0

    while current <= last:
        existing = get_archive_status(game_key, current)
        if not force and existing is not None and existing["status"] == "confirmed":
            counts["skipped"] += 1
            current += timedelta(days=1)
            continue

        attempts = (existing["attempts"] if existing else 0) + 1
        status, note = _attempt_fetch(game_key, current)
        record_archive_status(game_key, current, status, note, attempts)
        counts[status] += 1
        if on_progress is not None:
            on_progress(game_key, current, status, note)

        # Back off when the Internet Archive starts refusing us (repeated misses).
        if game_key in WAYBACK_GAMES and status != "confirmed":
            consecutive_failures += 1
            if consecutive_failures % 6 == 0:
                time.sleep(min(60.0, max(pace_seconds * 10, 15.0)))
        else:
            consecutive_failures = 0

        if pace_seconds > 0:
            time.sleep(pace_seconds)
        current += timedelta(days=1)

    return counts


def backfill_all(
    *,
    start: date | None = None,
    end: date | None = None,
    pace_seconds: float = 1.5,
    force: bool = False,
    on_progress: ProgressCallback | None = None,
) -> dict[str, Counter]:
    return {
        game_key: backfill_game(
            game_key,
            start=start,
            end=end,
            pace_seconds=pace_seconds,
            force=force,
            on_progress=on_progress,
        )
        for game_key in ARCHIVE_GAME_KEYS
    }


def _attempt_fetch(game_key: str, puzzle_date: date) -> tuple[str, str]:
    """Fetch+cache one puzzle, returning (status, note) for the ledger."""
    try:
        if game_key == "wordle":
            record = get_daily_answer(puzzle_date, force_refresh=True)
            status = str(record.get("status"))
            return ("confirmed" if status not in {"unavailable", "dev-fallback"} else "missing", status)

        payload = get_public_puzzle(
            game_key, puzzle_date, {"difficulty": "medium"}, force_refresh=True
        )
        status = str(payload.get("status", ""))
        return ("confirmed" if status == "confirmed" else "generated", status)
    except RuntimeError as exc:
        return ("missing", str(exc))
    except Exception as exc:  # noqa: BLE001 - recorded for the operator
        return ("error", str(exc))


def get_archive_status(game_key: str, puzzle_date: date) -> dict[str, Any] | None:
    with connect() as connection:
        row = connection.execute(
            """
            SELECT game_key, puzzle_date, status, note, attempts, last_attempt_at
            FROM archive_status
            WHERE game_key = ? AND puzzle_date = ? AND variant = ''
            """,
            (game_key, puzzle_date.isoformat()),
        ).fetchone()
    return dict(row) if row else None


def record_archive_status(
    game_key: str, puzzle_date: date, status: str, note: str, attempts: int
) -> None:
    now = datetime.now().astimezone().isoformat()
    with connect() as connection:
        connection.execute(
            """
            INSERT INTO archive_status (
              game_key, puzzle_date, variant, status, note, attempts, last_attempt_at
            )
            VALUES (?, ?, '', ?, ?, ?, ?)
            ON CONFLICT(game_key, puzzle_date, variant) DO UPDATE SET
              status = excluded.status,
              note = excluded.note,
              attempts = excluded.attempts,
              last_attempt_at = excluded.last_attempt_at
            """,
            (game_key, puzzle_date.isoformat(), status, note[:500], attempts, now),
        )


def archive_coverage(game_key: str) -> dict[str, Any]:
    first = archive_first_date(game_key)
    total_days = (get_puzzle_date() - first).days + 1
    with connect() as connection:
        rows = connection.execute(
            "SELECT status, COUNT(*) AS count FROM archive_status WHERE game_key = ? GROUP BY status",
            (game_key,),
        ).fetchall()
    by_status = {row["status"]: row["count"] for row in rows}
    return {
        "firstDate": first.isoformat(),
        "totalDays": total_days,
        "confirmed": by_status.get("confirmed", 0),
        "generated": by_status.get("generated", 0),
        "missing": by_status.get("missing", 0),
        "error": by_status.get("error", 0),
        "remaining": total_days - sum(by_status.values()),
    }
