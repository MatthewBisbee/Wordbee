from __future__ import annotations

import json
import random
import re
from datetime import date, datetime
from html import unescape
from typing import Any

import requests

from ..daily_answer import get_puzzle_date
from ..db import connect
from .common import (
    SOURCE_TIMEOUT_SECONDS,
    SUDOKU_PAGE_URL,
    USER_AGENT,
    WAYBACK_AVAILABLE_URL,
    normalize_text,
)


SUDOKU_DIFFICULTIES = {"easy", "medium", "hard"}


def get_sudoku_puzzle(
    puzzle_date: date,
    difficulty: str,
    *,
    force_refresh: bool = False,
) -> dict[str, Any]:
    normalized_difficulty = normalize_sudoku_difficulty(difficulty)

    if not force_refresh:
        cached = get_cached_sudoku(puzzle_date, normalized_difficulty)
        if cached is not None:
            if cached["status"] == "confirmed":
                return cached
            fetched_at = datetime.fromisoformat(cached["fetched_at"])
            age_seconds = (datetime.now().astimezone() - fetched_at).total_seconds()
            if age_seconds <= 60 * 30:
                return cached

    # Today's board comes from the live NYT page; past boards are recovered from
    # the Internet Archive when a same-day snapshot exists.
    if puzzle_date >= get_puzzle_date():
        fetched = fetch_sudoku_source()
    else:
        fetched = fetch_sudoku_source_for_date(puzzle_date)
    if fetched["ok"]:
        fetched_date = fetched["puzzle_date"]
        saved_puzzle = None
        for difficulty_key, puzzle in fetched["puzzles"].items():
            saved = save_sudoku_puzzle(
                puzzle_date=fetched_date,
                difficulty=difficulty_key,
                external_id=str(puzzle.get("puzzle_id") or ""),
                display_date=fetched["display_date"],
                puzzle=puzzle["puzzle_data"]["puzzle"],
                solution=puzzle["puzzle_data"]["solution"],
                status="confirmed",
                source=fetched["source"],
            )
            if fetched_date == puzzle_date and difficulty_key == normalized_difficulty:
                saved_puzzle = saved

        if saved_puzzle is not None:
            return saved_puzzle

        cached_after_fetch = get_cached_sudoku(puzzle_date, normalized_difficulty)
        if cached_after_fetch is not None:
            return cached_after_fetch

    cached_generated = get_cached_sudoku(puzzle_date, normalized_difficulty)
    if cached_generated is not None:
        update_sudoku_cache_timestamp(puzzle_date, normalized_difficulty)
        return cached_generated

    fallback = create_sudoku_fallback(puzzle_date, normalized_difficulty)
    return save_sudoku_puzzle(
        puzzle_date=puzzle_date,
        difficulty=normalized_difficulty,
        external_id="",
        display_date=puzzle_date.strftime("%B %-d, %Y"),
        puzzle=fallback["puzzle"],
        solution=fallback["solution"],
        status="generated",
        source=fetched.get("source", {"id": "publisher", "ok": False, "error": "Fetch failed"}),
    )


def warm_sudoku_puzzles(puzzle_date: date) -> dict[str, Any]:
    cached_statuses = {
        difficulty: get_cached_sudoku(puzzle_date, difficulty)
        for difficulty in SUDOKU_DIFFICULTIES
    }
    if all(cached is not None and cached["status"] == "confirmed" for cached in cached_statuses.values()):
        return {
            "confirmed": True,
            "status": "cached",
            "difficulties": sorted(SUDOKU_DIFFICULTIES),
        }

    fetched = fetch_sudoku_source()
    if not fetched["ok"]:
        return {"confirmed": False, "status": "failed", "source": fetched["source"]}

    if fetched["puzzle_date"] != puzzle_date:
        return {
            "confirmed": False,
            "status": "date-mismatch",
            "fetchedDate": fetched["puzzle_date"].isoformat(),
        }

    saved_difficulties = []
    for difficulty_key, puzzle in fetched["puzzles"].items():
        save_sudoku_puzzle(
            puzzle_date=fetched["puzzle_date"],
            difficulty=difficulty_key,
            external_id=str(puzzle.get("puzzle_id") or ""),
            display_date=fetched["display_date"],
            puzzle=puzzle["puzzle_data"]["puzzle"],
            solution=puzzle["puzzle_data"]["solution"],
            status="confirmed",
            source=fetched["source"],
        )
        saved_difficulties.append(difficulty_key)

    return {
        "confirmed": set(saved_difficulties) == SUDOKU_DIFFICULTIES,
        "status": "fetched",
        "difficulties": sorted(saved_difficulties),
    }


def validate_sudoku_grid(puzzle_date: date, difficulty: str, raw_grid: object) -> dict[str, Any]:
    puzzle = get_sudoku_puzzle(puzzle_date, difficulty)
    grid = normalize_sudoku_grid(raw_grid)
    solution = puzzle["solution"]
    mistakes = [
        index
        for index, value in enumerate(grid)
        if value is not None and value != solution[index]
    ]
    is_complete = all(value is not None for value in grid)
    is_solved = is_complete and not mistakes

    return {
        "complete": is_complete,
        "mistakes": mistakes,
        "solved": is_solved,
    }


def get_sudoku_hint(puzzle_date: date, difficulty: str, raw_cell: object) -> dict[str, Any]:
    puzzle = get_sudoku_puzzle(puzzle_date, normalize_sudoku_difficulty(difficulty))
    if not isinstance(raw_cell, int) or isinstance(raw_cell, bool) or raw_cell < 0 or raw_cell >= 81:
        raise ValueError("Invalid cell")
    return {"index": raw_cell, "value": puzzle["solution"][raw_cell]}


def public_sudoku_puzzle(puzzle: dict[str, Any]) -> dict[str, Any]:
    return {
        "gameKey": "sudoku",
        "date": puzzle["date"],
        "difficulty": puzzle["difficulty"],
        "displayDate": puzzle["displayDate"],
        "status": puzzle["status"],
        "puzzle": puzzle["puzzle"],
    }


def get_cached_sudoku(puzzle_date: date, difficulty: str) -> dict[str, Any] | None:
    with connect() as connection:
        row = connection.execute(
            """
            SELECT puzzle_date, difficulty, external_id, display_date,
                   puzzle_json, solution_json, status, source_json,
                   fetched_at, updated_at
            FROM daily_sudoku
            WHERE puzzle_date = ? AND difficulty = ?
            """,
            (puzzle_date.isoformat(), difficulty),
        ).fetchone()

    return serialize_sudoku(row) if row else None


def save_sudoku_puzzle(
    *,
    puzzle_date: date,
    difficulty: str,
    external_id: str,
    display_date: str,
    puzzle: list[int],
    solution: list[int],
    status: str,
    source: dict[str, Any],
) -> dict[str, Any]:
    normalized_puzzle = normalize_sudoku_numbers(puzzle, allow_zero=True)
    normalized_solution = normalize_sudoku_numbers(solution, allow_zero=False)
    now = datetime.now().astimezone().isoformat()
    with connect() as connection:
        connection.execute(
            """
            INSERT INTO daily_sudoku (
              puzzle_date, difficulty, external_id, display_date, puzzle_json,
              solution_json, status, source_json, fetched_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(puzzle_date, difficulty) DO UPDATE SET
              external_id = excluded.external_id,
              display_date = excluded.display_date,
              puzzle_json = excluded.puzzle_json,
              solution_json = excluded.solution_json,
              status = excluded.status,
              source_json = excluded.source_json,
              fetched_at = excluded.fetched_at,
              updated_at = excluded.updated_at
            """,
            (
                puzzle_date.isoformat(),
                difficulty,
                external_id,
                display_date,
                json.dumps(normalized_puzzle, separators=(",", ":")),
                json.dumps(normalized_solution, separators=(",", ":")),
                status,
                json.dumps(source, separators=(",", ":")),
                now,
                now,
            ),
        )

    cached = get_cached_sudoku(puzzle_date, difficulty)
    if cached is None:
        raise RuntimeError("Unable to cache Sudoku puzzle")
    return cached


def update_sudoku_cache_timestamp(puzzle_date: date, difficulty: str) -> None:
    now = datetime.now().astimezone().isoformat()
    with connect() as connection:
        connection.execute(
            """
            UPDATE daily_sudoku
            SET fetched_at = ?, updated_at = ?
            WHERE puzzle_date = ? AND difficulty = ?
            """,
            (now, now, puzzle_date.isoformat(), difficulty),
        )


def fetch_sudoku_source() -> dict[str, Any]:
    url = SUDOKU_PAGE_URL
    source = {"id": "publisher", "url": url, "ok": False}

    try:
        response = requests.get(
            url,
            headers={"User-Agent": USER_AGENT, "Accept": "text/html"},
            timeout=SOURCE_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        game_data = extract_sudoku_game_data(response.text)
        fetched_date, puzzles = normalize_sudoku_payload(game_data)
    except Exception as exc:
        source["error"] = str(exc)
        return {"ok": False, "source": source}

    source["ok"] = True
    return {
        "ok": True,
        "puzzle_date": fetched_date,
        "display_date": normalize_text(game_data.get("displayDate"), max_length=80)
        or fetched_date.isoformat(),
        "puzzles": puzzles,
        "source": source,
    }


def fetch_sudoku_source_for_date(puzzle_date: date) -> dict[str, Any]:
    """Recover a past day's Sudoku boards from an Internet Archive snapshot.

    NYT does not expose a dated Sudoku endpoint, so we ask the Wayback Machine for
    the closest capture of the puzzle page and only accept it when the archived
    ``window.gameData`` reports the exact date we requested. Anything else falls
    through to the deterministic generator.
    """
    source: dict[str, Any] = {"id": "wayback", "url": WAYBACK_AVAILABLE_URL, "ok": False}

    try:
        availability = requests.get(
            WAYBACK_AVAILABLE_URL,
            params={
                "url": "nytimes.com/puzzles/sudoku",
                "timestamp": f"{puzzle_date.strftime('%Y%m%d')}120000",
            },
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            timeout=SOURCE_TIMEOUT_SECONDS,
        )
        availability.raise_for_status()
        snapshot = (availability.json().get("archived_snapshots") or {}).get("closest") or {}
        snapshot_url = snapshot.get("url")
        if not snapshot.get("available") or not isinstance(snapshot_url, str):
            raise ValueError("No archived Sudoku snapshot for this date")

        # Request the raw archived HTML (id_) so Wayback does not inject its toolbar.
        raw_url = re.sub(r"/web/(\d+)/", r"/web/\1id_/", snapshot_url, count=1)
        response = requests.get(
            raw_url,
            headers={"User-Agent": USER_AGENT, "Accept": "text/html"},
            timeout=SOURCE_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        game_data = extract_sudoku_game_data(response.text)
        fetched_date, puzzles = normalize_sudoku_payload(game_data)
    except Exception as exc:
        source["error"] = str(exc)
        return {"ok": False, "source": source}

    if fetched_date != puzzle_date:
        source["error"] = f"Archived snapshot was for {fetched_date.isoformat()}"
        return {"ok": False, "source": source}

    source["ok"] = True
    return {
        "ok": True,
        "puzzle_date": fetched_date,
        "display_date": normalize_text(game_data.get("displayDate"), max_length=80)
        or fetched_date.isoformat(),
        "puzzles": puzzles,
        "source": source,
    }


def extract_sudoku_game_data(raw_html: str) -> dict[str, Any]:
    match = re.search(
        r"window\.gameData\s*=\s*(\{.*?\})\s*</script>",
        raw_html,
        flags=re.DOTALL,
    )
    if not match:
        raise ValueError("Sudoku game data was missing")

    return json.loads(unescape(match.group(1)))


def normalize_sudoku_payload(
    payload: dict[str, Any]
) -> tuple[date, dict[str, dict[str, Any]]]:
    puzzles = {}
    print_date_str = None
    for difficulty in SUDOKU_DIFFICULTIES:
        raw_puzzle = payload.get(difficulty)
        if not isinstance(raw_puzzle, dict):
            raise ValueError("Sudoku payload was missing a difficulty")
        
        current_print_date = raw_puzzle.get("print_date")
        if not current_print_date:
            raise ValueError("Sudoku payload print_date was missing")
            
        if print_date_str is None:
            print_date_str = current_print_date
        elif current_print_date != print_date_str:
            raise ValueError("Sudoku payload had mismatched print_dates")

        puzzle_data = raw_puzzle.get("puzzle_data")
        if not isinstance(puzzle_data, dict):
            raise ValueError("Sudoku puzzle data was missing")
        normalize_sudoku_numbers(puzzle_data.get("puzzle"), allow_zero=True)
        normalize_sudoku_numbers(puzzle_data.get("solution"), allow_zero=False)
        puzzles[difficulty] = raw_puzzle

    parsed_date = date.fromisoformat(print_date_str)
    return parsed_date, puzzles


def create_sudoku_fallback(puzzle_date: date, difficulty: str) -> dict[str, list[int]]:
    rng = random.Random(f"sudoku:{puzzle_date.isoformat()}:{difficulty}")
    base = 3
    side = base * base

    def pattern(row: int, column: int) -> int:
        return (base * (row % base) + row // base + column) % side

    def shuffle(sequence: range | list[int]) -> list[int]:
        values = list(sequence)
        rng.shuffle(values)
        return values

    row_groups = shuffle(range(base))
    rows = [group * base + row for group in row_groups for row in shuffle(range(base))]
    column_groups = shuffle(range(base))
    columns = [group * base + column for group in column_groups for column in shuffle(range(base))]
    numbers = shuffle(range(1, side + 1))
    solution = [numbers[pattern(row, column)] for row in rows for column in columns]

    givens_by_difficulty = {"easy": 43, "medium": 34, "hard": 28}
    givens = givens_by_difficulty[difficulty]
    keep_indices = set(rng.sample(range(side * side), givens))
    puzzle = [value if index in keep_indices else 0 for index, value in enumerate(solution)]
    return {"puzzle": puzzle, "solution": solution}


def serialize_sudoku(row) -> dict[str, Any]:
    return {
        "date": row["puzzle_date"],
        "difficulty": row["difficulty"],
        "displayDate": row["display_date"],
        "externalId": row["external_id"],
        "puzzle": json.loads(row["puzzle_json"]),
        "solution": json.loads(row["solution_json"]),
        "source": json.loads(row["source_json"]),
        "status": row["status"],
        "fetched_at": row["fetched_at"],
    }


def normalize_sudoku_difficulty(difficulty: str) -> str:
    normalized = difficulty.strip().casefold() if isinstance(difficulty, str) else "medium"
    if normalized not in SUDOKU_DIFFICULTIES:
        raise ValueError("Invalid Sudoku difficulty")
    return normalized


def normalize_sudoku_grid(raw_grid: object) -> list[int | None]:
    if not isinstance(raw_grid, list) or len(raw_grid) != 81:
        raise ValueError("Invalid Sudoku grid")

    grid = []
    for value in raw_grid:
        if value in {"", None, 0}:
            grid.append(None)
            continue
        if not isinstance(value, int) or value < 1 or value > 9:
            raise ValueError("Invalid Sudoku grid")
        grid.append(value)

    return grid


def normalize_sudoku_numbers(raw_values: object, *, allow_zero: bool) -> list[int]:
    if not isinstance(raw_values, list) or len(raw_values) != 81:
        raise ValueError("Invalid Sudoku puzzle")

    values = []
    minimum = 0 if allow_zero else 1
    for value in raw_values:
        if not isinstance(value, int) or value < minimum or value > 9:
            raise ValueError("Invalid Sudoku puzzle")
        values.append(value)

    return values
