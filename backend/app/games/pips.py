"""NYT Pips — a daily domino-placement logic puzzle.

Each day NYT publishes three independent Pips puzzles (easy / medium / hard) at a
single dated, *public* JSON endpoint (no subscriber cookie required):

    https://www.nytimes.com/svc/pips/v1/<YYYY-MM-DD>.json

A puzzle is an irregular board of cells (``[row, col]`` coordinates) partitioned
into constraint **regions**, a bag of **dominoes** (each ``[a, b]`` with pips
0-6), and the constructor's **solution** (one ``[[r1,c1],[r2,c2]]`` placement per
domino, in domino order — cell 1 takes ``a`` pips, cell 2 takes ``b``). Region
constraint types:

    sum      — the region's total pips must equal ``target``
    less     — the total must be < ``target``
    greater  — the total must be > ``target``
    equals   — every cell in the region shows the same value
    unequal  — every cell in the region shows a different value
    empty    — no constraint (a plain region)

The archive is dense and gapless from the first Pips (2025-08-18), so serving and
backfill both just fetch the exact date. Like Sudoku, a day is keyed by
``(puzzle_date, difficulty)``; like Crossword, the solution never leaves the
server — the public payload carries only the board/regions/dominoes and win
validation happens server-side (see :func:`validate_pips_solution`). Region
satisfaction feedback while playing is computed on the client from the region
definitions alone (no answer needed), exactly as the real game does.
"""
from __future__ import annotations

import json
from collections import Counter
from datetime import date, datetime
from typing import Any

import requests

from ..daily_answer import get_puzzle_date
from ..db import connect_game
from .common import SOURCE_TIMEOUT_SECONDS, USER_AGENT


PIPS_FIRST_DATE = date(2025, 8, 18)
PIPS_DIFFICULTIES = {"easy", "medium", "hard"}
PIPS_API_URL = "https://www.nytimes.com/svc/pips/v1/{date}.json"

REGION_TYPES = {"sum", "less", "greater", "equals", "unequal", "empty"}
TARGETED_TYPES = {"sum", "less", "greater"}
MAX_PIP = 6


# --- Serving ----------------------------------------------------------------


def get_pips_puzzle(
    puzzle_date: date,
    difficulty: str,
    *,
    force_refresh: bool = False,
) -> dict[str, Any]:
    normalized_difficulty = normalize_pips_difficulty(difficulty)

    if not force_refresh:
        cached = get_cached_pips(puzzle_date, normalized_difficulty)
        if cached is not None and cached["status"] == "confirmed":
            return cached

    fetched = fetch_pips_source(puzzle_date)
    if fetched["ok"]:
        saved_puzzle = None
        for difficulty_key, puzzle in fetched["puzzles"].items():
            saved = save_pips_puzzle(
                puzzle_date=puzzle_date,
                difficulty=difficulty_key,
                editor=fetched["editor"],
                puzzle=puzzle,
                status="confirmed",
                source=fetched["source"],
            )
            if difficulty_key == normalized_difficulty:
                saved_puzzle = saved
        if saved_puzzle is not None:
            return saved_puzzle

    cached = get_cached_pips(puzzle_date, normalized_difficulty)
    if cached is not None:
        return cached

    raise RuntimeError(fetched.get("source", {}).get("error") or "Pips puzzle is unavailable")


def warm_pips_puzzle(puzzle_date: date) -> dict[str, Any]:
    cached_statuses = {
        difficulty: get_cached_pips(puzzle_date, difficulty)
        for difficulty in PIPS_DIFFICULTIES
    }
    if all(cached is not None and cached["status"] == "confirmed" for cached in cached_statuses.values()):
        return {"confirmed": True, "status": "cached", "difficulties": sorted(PIPS_DIFFICULTIES)}

    fetched = fetch_pips_source(puzzle_date)
    if not fetched["ok"]:
        return {"confirmed": False, "status": "failed", "source": fetched["source"]}

    saved_difficulties = []
    for difficulty_key, puzzle in fetched["puzzles"].items():
        save_pips_puzzle(
            puzzle_date=puzzle_date,
            difficulty=difficulty_key,
            editor=fetched["editor"],
            puzzle=puzzle,
            status="confirmed",
            source=fetched["source"],
        )
        saved_difficulties.append(difficulty_key)

    return {
        "confirmed": set(saved_difficulties) == PIPS_DIFFICULTIES,
        "status": "fetched",
        "difficulties": sorted(saved_difficulties),
    }


def public_pips_puzzle(puzzle: dict[str, Any]) -> dict[str, Any]:
    """Everything the client needs to render and play — but not the solution."""
    return {
        "gameKey": "pips",
        "date": puzzle["date"],
        "difficulty": puzzle["difficulty"],
        "displayDate": puzzle["displayDate"],
        "status": puzzle["status"],
        "editor": puzzle["editor"],
        "constructors": puzzle["constructors"],
        "rows": puzzle["rows"],
        "cols": puzzle["cols"],
        "dominoes": puzzle["dominoes"],
        "regions": puzzle["regions"],
    }


def public_pips_solution(puzzle: dict[str, Any]) -> dict[str, Any]:
    """The constructor's placements — for Reveal and completed-board hydration."""
    return {
        "date": puzzle["date"],
        "difficulty": puzzle["difficulty"],
        "dominoes": puzzle["dominoes"],
        "solution": puzzle["solution"],
    }


# --- Validation -------------------------------------------------------------


def validate_pips_solution(puzzle_date: date, difficulty: str, raw_placements: object) -> bool:
    """True when ``raw_placements`` is a genuine solution to the day's puzzle.

    Placements mirror NYT's ``solution`` shape: one ``[[r1,c1],[r2,c2]]`` entry per
    domino, in the puzzle's domino order (cell 1 takes the domino's first pip,
    cell 2 the second). We verify the placements tile the exact board with the
    exact domino bag (adjacent, non-overlapping, complete) and satisfy every
    region constraint — not that they match the stored solution, since only the
    win condition matters.
    """
    puzzle = get_pips_puzzle(puzzle_date, normalize_pips_difficulty(difficulty))
    dominoes = puzzle["dominoes"]
    regions = puzzle["regions"]

    if not isinstance(raw_placements, list) or len(raw_placements) != len(dominoes):
        return False

    board = board_cells(regions)
    filled: dict[tuple[int, int], int] = {}
    used_dominoes: list[tuple[int, int]] = []

    for domino, placement in zip(dominoes, raw_placements):
        cells = normalize_placement(placement)
        if cells is None:
            return False
        (r1, c1), (r2, c2) = cells
        if abs(r1 - r2) + abs(c1 - c2) != 1:  # must be orthogonally adjacent
            return False
        for cell in cells:
            if cell not in board or cell in filled:
                return False
        filled[(r1, c1)] = domino[0]
        filled[(r2, c2)] = domino[1]
        used_dominoes.append(tuple(sorted(domino)))

    if set(filled) != board:
        return False
    if Counter(used_dominoes) != Counter(tuple(sorted(domino)) for domino in dominoes):
        return False

    return all(region_satisfied([filled[tuple(index)] for index in region["indices"]], region)
               for region in regions)


def region_satisfied(values: list[int], region: dict[str, Any]) -> bool:
    region_type = region["type"]
    target = region.get("target")
    total = sum(values)
    if region_type == "sum":
        return total == target
    if region_type == "less":
        return total < target
    if region_type == "greater":
        return total > target
    if region_type == "equals":
        return len(set(values)) <= 1
    if region_type == "unequal":
        return len(set(values)) == len(values)
    if region_type == "empty":
        return True
    return False


def board_cells(regions: list[dict[str, Any]]) -> set[tuple[int, int]]:
    return {(index[0], index[1]) for region in regions for index in region["indices"]}


def normalize_placement(raw: object) -> tuple[tuple[int, int], tuple[int, int]] | None:
    if not isinstance(raw, list) or len(raw) != 2:
        return None
    cells: list[tuple[int, int]] = []
    for cell in raw:
        if not isinstance(cell, list) or len(cell) != 2:
            return None
        r, c = cell
        if not isinstance(r, int) or not isinstance(c, int) or isinstance(r, bool) or isinstance(c, bool):
            return None
        if r < 0 or c < 0:
            return None
        cells.append((r, c))
    return cells[0], cells[1]


# --- Sourcing ---------------------------------------------------------------


def fetch_pips_source(puzzle_date: date) -> dict[str, Any]:
    url = PIPS_API_URL.format(date=puzzle_date.isoformat())
    source: dict[str, Any] = {"id": "nyt-pips-v1", "url": url, "ok": False}

    try:
        response = requests.get(
            url,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            timeout=SOURCE_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        payload = response.json()
        puzzles = normalize_pips_payload(payload, puzzle_date)
    except Exception as exc:  # noqa: BLE001 - surfaced to caller for diagnostics
        source["error"] = str(exc)
        return {"ok": False, "source": source}

    source["ok"] = True
    return {
        "ok": True,
        "editor": normalize_str(payload.get("editor")),
        "puzzles": puzzles,
        "source": source,
    }


def normalize_pips_payload(payload: object, puzzle_date: date) -> dict[str, dict[str, Any]]:
    if not isinstance(payload, dict):
        raise ValueError("Pips payload was not an object")

    print_date = payload.get("printDate")
    if print_date and print_date != puzzle_date.isoformat():
        raise ValueError(f"Pips print_date mismatch ({print_date})")

    puzzles: dict[str, dict[str, Any]] = {}
    for difficulty in PIPS_DIFFICULTIES:
        raw = payload.get(difficulty)
        if not isinstance(raw, dict):
            raise ValueError(f"Pips payload missing '{difficulty}'")
        puzzles[difficulty] = normalize_pips_puzzle(raw)
    return puzzles


def normalize_pips_puzzle(raw: dict[str, Any]) -> dict[str, Any]:
    dominoes = normalize_dominoes(raw.get("dominoes"))
    regions = normalize_regions(raw.get("regions"))
    solution = normalize_solution(raw.get("solution"), len(dominoes))

    cells = board_cells(regions)
    if len(cells) != 2 * len(dominoes):
        raise ValueError("Pips board size does not match the domino count")
    rows = max(r for r, _ in cells) + 1
    cols = max(c for _, c in cells) + 1

    return {
        "external_id": str(raw.get("id") or ""),
        "backend_id": str(raw.get("backendId") or ""),
        "constructors": normalize_str(raw.get("constructors")),
        "rows": rows,
        "cols": cols,
        "dominoes": dominoes,
        "regions": regions,
        "solution": solution,
    }


def normalize_dominoes(raw: object) -> list[list[int]]:
    if not isinstance(raw, list) or not raw:
        raise ValueError("Pips dominoes missing")
    dominoes: list[list[int]] = []
    for pair in raw:
        if not isinstance(pair, list) or len(pair) != 2:
            raise ValueError("Invalid domino")
        a, b = pair
        for value in (a, b):
            if not isinstance(value, int) or isinstance(value, bool) or value < 0 or value > MAX_PIP:
                raise ValueError("Invalid pip value")
        dominoes.append([a, b])
    return dominoes


def normalize_regions(raw: object) -> list[dict[str, Any]]:
    if not isinstance(raw, list) or not raw:
        raise ValueError("Pips regions missing")
    regions: list[dict[str, Any]] = []
    for region in raw:
        if not isinstance(region, dict):
            raise ValueError("Invalid region")
        region_type = region.get("type")
        if region_type not in REGION_TYPES:
            raise ValueError(f"Unknown region type '{region_type}'")
        indices = region.get("indices")
        if not isinstance(indices, list) or not indices:
            raise ValueError("Region missing indices")
        normalized_indices: list[list[int]] = []
        for index in indices:
            if not isinstance(index, list) or len(index) != 2:
                raise ValueError("Invalid region index")
            r, c = index
            if not isinstance(r, int) or not isinstance(c, int) or isinstance(r, bool) or isinstance(c, bool):
                raise ValueError("Invalid region index")
            normalized_indices.append([r, c])
        entry: dict[str, Any] = {"indices": normalized_indices, "type": region_type}
        if region_type in TARGETED_TYPES:
            target = region.get("target")
            if not isinstance(target, int) or isinstance(target, bool):
                raise ValueError("Targeted region missing numeric target")
            entry["target"] = target
        regions.append(entry)
    return regions


def normalize_solution(raw: object, domino_count: int) -> list[list[list[int]]]:
    if not isinstance(raw, list) or len(raw) != domino_count:
        raise ValueError("Pips solution missing or wrong length")
    solution: list[list[list[int]]] = []
    for placement in raw:
        cells = normalize_placement(placement)
        if cells is None:
            raise ValueError("Invalid solution placement")
        solution.append([list(cells[0]), list(cells[1])])
    return solution


def normalize_str(raw: object) -> str:
    return raw.strip() if isinstance(raw, str) else ""


# --- Persistence ------------------------------------------------------------


def get_cached_pips(puzzle_date: date, difficulty: str) -> dict[str, Any] | None:
    with connect_game("pips") as connection:
        row = connection.execute(
            """
            SELECT puzzle_date, difficulty, external_id, backend_id, editor,
                   constructors, rows, cols, dominoes_json, regions_json,
                   solution_json, status, source_json, fetched_at, updated_at
            FROM daily_pips
            WHERE puzzle_date = ? AND difficulty = ?
            """,
            (puzzle_date.isoformat(), difficulty),
        ).fetchone()
    return serialize_pips(row) if row else None


def save_pips_puzzle(
    *,
    puzzle_date: date,
    difficulty: str,
    editor: str,
    puzzle: dict[str, Any],
    status: str,
    source: dict[str, Any],
) -> dict[str, Any]:
    now = datetime.now().astimezone().isoformat()
    with connect_game("pips") as connection:
        connection.execute(
            """
            INSERT INTO daily_pips (
              puzzle_date, difficulty, external_id, backend_id, editor,
              constructors, rows, cols, dominoes_json, regions_json,
              solution_json, status, source_json, fetched_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(puzzle_date, difficulty) DO UPDATE SET
              external_id = excluded.external_id,
              backend_id = excluded.backend_id,
              editor = excluded.editor,
              constructors = excluded.constructors,
              rows = excluded.rows,
              cols = excluded.cols,
              dominoes_json = excluded.dominoes_json,
              regions_json = excluded.regions_json,
              solution_json = excluded.solution_json,
              status = excluded.status,
              source_json = excluded.source_json,
              fetched_at = excluded.fetched_at,
              updated_at = excluded.updated_at
            """,
            (
                puzzle_date.isoformat(),
                difficulty,
                puzzle["external_id"],
                puzzle["backend_id"],
                editor,
                puzzle["constructors"],
                puzzle["rows"],
                puzzle["cols"],
                json.dumps(puzzle["dominoes"], separators=(",", ":")),
                json.dumps(puzzle["regions"], separators=(",", ":")),
                json.dumps(puzzle["solution"], separators=(",", ":")),
                status,
                json.dumps(source, separators=(",", ":")),
                now,
                now,
            ),
        )

    cached = get_cached_pips(puzzle_date, difficulty)
    if cached is None:
        raise RuntimeError("Unable to cache Pips puzzle")
    return cached


def serialize_pips(row) -> dict[str, Any]:
    puzzle_date = row["puzzle_date"]
    return {
        "date": puzzle_date,
        "difficulty": row["difficulty"],
        "displayDate": date.fromisoformat(puzzle_date).strftime("%B %-d, %Y"),
        "externalId": row["external_id"],
        "backendId": row["backend_id"],
        "editor": row["editor"] or "",
        "constructors": row["constructors"] or "",
        "rows": row["rows"],
        "cols": row["cols"],
        "dominoes": json.loads(row["dominoes_json"]),
        "regions": json.loads(row["regions_json"]),
        "solution": json.loads(row["solution_json"]),
        "status": row["status"],
        "source": json.loads(row["source_json"]),
        "fetched_at": row["fetched_at"],
    }


def normalize_pips_difficulty(difficulty: object) -> str:
    normalized = difficulty.strip().casefold() if isinstance(difficulty, str) else "easy"
    if normalized not in PIPS_DIFFICULTIES:
        raise ValueError("Invalid Pips difficulty")
    return normalized
