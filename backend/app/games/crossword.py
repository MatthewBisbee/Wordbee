"""The Crossword — NYT's flagship daily crossword.

Unlike The Mini/The Midi (deliberately out of scope), this is the full daily
puzzle: 15×15 on weekdays, 21×21 on Sundays. NYT exposes two dated,
subscriber-only endpoints:

* a **listing** — ``/svc/crosswords/v3/undefined/puzzles.json`` filtered by
  ``publish_type=daily`` and a date range — which maps each ``print_date`` to a
  ``puzzle_id`` (returns up to 100 results, newest first);
* the **puzzle** — ``/svc/crosswords/v6/puzzle/<id>.json`` — which carries the
  grid (``body[0].cells``) and clue list (``body[0].clues``). The cells hold the
  answers, so this needs the operator's authenticated ``NYT_COOKIE``.

The archive reaches back to the very first NYT crossword (1942-02-15). Coverage
is gapless from Will Shortz's first puzzle (1993-11-21) onward but sparse before
it. Per the operator's request, a requested date with no puzzle **snaps to the
nearest available date** (rounding *down* when equidistant); a date older than
the very first snaps up to it (the registry clamp handles that end).

Serving is local-first: a confirmed row is returned with no network; only
uncached dates hit NYT, then cache. A full ``scripts/crossword_backfill.py`` run
solidifies the entire history into ``crossword.sqlite`` so the app is source
independent afterwards.
"""
from __future__ import annotations

import json
import os
import re
from datetime import date, datetime, timedelta
from typing import Any

import requests

from ..daily_answer import get_puzzle_date
from ..db import connect_game
from .common import SOURCE_TIMEOUT_SECONDS, USER_AGENT, normalize_text


CROSSWORD_FIRST_DATE = date(1942, 2, 15)

CROSSWORD_LIST_URL = "https://www.nytimes.com/svc/crosswords/v3/undefined/puzzles.json"
CROSSWORD_PUZZLE_URL = "https://www.nytimes.com/svc/crosswords/v6/puzzle/{puzzle_id}.json"

# Widening half-windows (in days) used when snapping a gap date to the nearest
# available puzzle. Gaps only exist in the sparse pre-1993 era, where density is
# low enough that the listing's 100-result cap never bites; the final window is a
# safety net spanning the whole archive.
NEAREST_WINDOWS_DAYS = (30, 120, 400, 1500, 6000, 40000)


# --- HTTP -------------------------------------------------------------------


def _crossword_headers(accept: str = "application/json") -> dict[str, str]:
    headers = {"User-Agent": USER_AGENT, "Accept": accept}
    cookie = os.environ.get("NYT_COOKIE")
    if cookie:
        headers["Cookie"] = cookie
    return headers


def _fetch_json(url: str) -> Any:
    response = requests.get(url, headers=_crossword_headers(), timeout=SOURCE_TIMEOUT_SECONDS)
    response.raise_for_status()
    return response.json()


def fetch_crossword_listing(start: date, end: date) -> list[dict[str, Any]]:
    """Daily puzzles published in ``[start, end]`` (newest first, ≤100)."""
    url = (
        f"{CROSSWORD_LIST_URL}?publish_type=daily"
        f"&date_start={start.isoformat()}&date_end={end.isoformat()}"
    )
    payload = _fetch_json(url)
    results = payload.get("results") if isinstance(payload, dict) else None
    return [entry for entry in results if isinstance(entry, dict)] if isinstance(results, list) else []


def find_available_puzzle_id(puzzle_date: date) -> dict[str, Any] | None:
    """The listing entry for exactly ``puzzle_date``, or ``None`` if none exists."""
    for entry in fetch_crossword_listing(puzzle_date, puzzle_date):
        if entry.get("print_date") == puzzle_date.isoformat() and entry.get("puzzle_id"):
            return entry
    return None


def fetch_crossword_puzzle_by_id(puzzle_id: int | str) -> dict[str, Any]:
    payload = _fetch_json(CROSSWORD_PUZZLE_URL.format(puzzle_id=puzzle_id))
    if not isinstance(payload, dict):
        raise ValueError("Crossword payload was not an object")
    return payload


def fetch_crossword_from_xwordinfo(puzzle_date: date) -> dict[str, Any] | None:
    """Fetch and parse the daily crossword from xwordinfo (cookie-free)."""
    date_str = puzzle_date.strftime("%m/%d/%Y")
    url = f"https://www.xwordinfo.com/JSON/Data.ashx?date={date_str}"
    headers = {"User-Agent": USER_AGENT, "Referer": "https://www.xwordinfo.com/"}
    try:
        response = requests.get(url, headers=headers, timeout=SOURCE_TIMEOUT_SECONDS)
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        raise RuntimeError(f"xwordinfo fetch failed: {exc}") from exc

    if not payload or not payload.get("valid"):
        return None

    width = int(payload["size"]["cols"])
    height = int(payload["size"]["rows"])
    grid = payload.get("grid") or []
    gridnums = payload.get("gridnums") or []

    if len(grid) != width * height or len(gridnums) != width * height:
        raise ValueError("Invalid grid size in xwordinfo payload")

    cells: list[dict[str, Any] | None] = []
    for i in range(width * height):
        val = grid[i]
        if val == ".":
            cells.append(None)
        else:
            label = gridnums[i]
            cells.append({
                "answer": str(val).upper(),
                "label": str(label) if label > 0 else None
            })

    across_cells_map = {}
    down_cells_map = {}
    for r in range(height):
        for c in range(width):
            i = r * width + c
            if grid[i] == ".":
                continue
            is_across = (c == 0 or grid[i - 1] == ".") and (c + 1 < width and grid[i + 1] != ".")
            if is_across:
                word_cells = []
                curr = i
                while curr < (r + 1) * width and grid[curr] != ".":
                    word_cells.append(curr)
                    curr += 1
                across_cells_map[str(gridnums[i])] = word_cells
            is_down = (r == 0 or grid[i - width] == ".") and (r + width < width * height and grid[i + width] != ".")
            if is_down:
                word_cells = []
                curr = i
                while curr < width * height and grid[curr] != ".":
                    word_cells.append(curr)
                    curr += width
                down_cells_map[str(gridnums[i])] = word_cells

    pattern = re.compile(r"^(\d+)\.\s*(.*)$")
    clues = []
    for direction, mapped_cells in [("across", across_cells_map), ("down", down_cells_map)]:
        clue_list = payload.get("clues", {}).get(direction, [])
        for clue_str in clue_list:
            match = pattern.match(clue_str)
            if not match:
                continue
            label = match.group(1)
            text = match.group(2)
            if label in mapped_cells:
                clues.append({
                    "label": label,
                    "direction": direction,
                    "cells": mapped_cells[label],
                    "text": normalize_text(text, max_length=300),
                })

    author = normalize_text(payload.get("author"), max_length=160)
    title = normalize_text(payload.get("title"), max_length=120)

    return {
        "external_id": str(payload.get("id") or ""),
        "print_date": puzzle_date.isoformat(),
        "title": title,
        "author": author,
        "editor": normalize_text(payload.get("editor"), max_length=80),
        "width": width,
        "height": height,
        "cells": cells,
        "clues": clues,
    }


# --- Normalization ----------------------------------------------------------


def normalize_crossword_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Reduce NYT's v6 puzzle JSON to the durable board + clues we cache."""
    bodies = payload.get("body")
    if not isinstance(bodies, list) or not bodies or not isinstance(bodies[0], dict):
        raise ValueError("Crossword body was missing")
    body = bodies[0]

    dimensions = body.get("dimensions")
    if not isinstance(dimensions, dict):
        raise ValueError("Crossword dimensions were missing")
    width = int(dimensions.get("width") or 0)
    height = int(dimensions.get("height") or 0)
    raw_cells = body.get("cells")
    if width <= 0 or height <= 0 or not isinstance(raw_cells, list) or len(raw_cells) != width * height:
        raise ValueError("Crossword grid was invalid")

    cells: list[dict[str, Any] | None] = []
    for cell in raw_cells:
        if not isinstance(cell, dict) or "answer" not in cell:
            # A block ({}) — nothing to solve here.
            cells.append(None)
            continue
        answer = str(cell.get("answer") or "").upper()
        label = cell.get("label")
        cells.append({"answer": answer, "label": str(label) if label is not None else None})

    raw_clues = body.get("clues")
    if not isinstance(raw_clues, list) or not raw_clues:
        raise ValueError("Crossword clues were missing")
    clues: list[dict[str, Any]] = []
    for clue in raw_clues:
        if not isinstance(clue, dict):
            raise ValueError("Crossword clue was invalid")
        direction = str(clue.get("direction") or "").strip().lower()
        if direction not in {"across", "down"}:
            direction = "down"
        clue_cells = [int(index) for index in (clue.get("cells") or []) if isinstance(index, int)]
        text = " ".join(
            str(segment.get("plain") or "").strip()
            for segment in (clue.get("text") or [])
            if isinstance(segment, dict)
        ).strip()
        clues.append(
            {
                "label": str(clue.get("label") or ""),
                "direction": direction,
                "cells": clue_cells,
                "text": text,
            }
        )

    publication_date = str(payload.get("publicationDate") or "")
    constructors = payload.get("constructors")
    author = ", ".join(str(name) for name in constructors) if isinstance(constructors, list) else ""

    return {
        "external_id": str(payload.get("id") or ""),
        "print_date": publication_date,
        "title": normalize_text(payload.get("title"), max_length=120),
        "author": normalize_text(author, max_length=160),
        "editor": normalize_text(payload.get("editor"), max_length=80),
        "width": width,
        "height": height,
        "cells": cells,
        "clues": clues,
    }


# --- Cache ------------------------------------------------------------------


def get_cached_crossword(puzzle_date: date) -> dict[str, Any] | None:
    with connect_game("crossword") as connection:
        row = connection.execute(
            """
            SELECT puzzle_date, external_id, title, author, editor, width, height,
                   cells_json, clues_json, status, source_json, fetched_at, updated_at
            FROM daily_crossword
            WHERE puzzle_date = ?
            """,
            (puzzle_date.isoformat(),),
        ).fetchone()
    return serialize_crossword(row) if row else None


def save_crossword_puzzle(
    *,
    puzzle_date: date,
    normalized: dict[str, Any],
    status: str,
    source: dict[str, Any],
) -> dict[str, Any]:
    now = datetime.now().astimezone().isoformat()
    with connect_game("crossword") as connection:
        connection.execute(
            """
            INSERT INTO daily_crossword (
              puzzle_date, external_id, title, author, editor, width, height,
              cells_json, clues_json, status, source_json, fetched_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(puzzle_date) DO UPDATE SET
              external_id = excluded.external_id,
              title = excluded.title,
              author = excluded.author,
              editor = excluded.editor,
              width = excluded.width,
              height = excluded.height,
              cells_json = excluded.cells_json,
              clues_json = excluded.clues_json,
              status = excluded.status,
              source_json = excluded.source_json,
              fetched_at = excluded.fetched_at,
              updated_at = excluded.updated_at
            """,
            (
                puzzle_date.isoformat(),
                normalized["external_id"],
                normalized["title"],
                normalized["author"],
                normalized["editor"],
                normalized["width"],
                normalized["height"],
                json.dumps(normalized["cells"], separators=(",", ":")),
                json.dumps(normalized["clues"], separators=(",", ":")),
                status,
                json.dumps(source, separators=(",", ":")),
                now,
                now,
            ),
        )

    cached = get_cached_crossword(puzzle_date)
    if cached is None:
        raise RuntimeError("Unable to cache Crossword puzzle")
    return cached


def serialize_crossword(row) -> dict[str, Any]:
    return {
        "date": row["puzzle_date"],
        "externalId": row["external_id"],
        "title": row["title"],
        "author": row["author"],
        "editor": row["editor"],
        "width": row["width"],
        "height": row["height"],
        "cells": json.loads(row["cells_json"]),
        "clues": json.loads(row["clues_json"]),
        "status": row["status"],
        "source": json.loads(row["source_json"]),
        "fetched_at": row["fetched_at"],
    }


# --- Fetch + snap -----------------------------------------------------------


def _fetch_and_cache_exact(puzzle_date: date) -> dict[str, Any] | None:
    """Fetch and cache the puzzle published on exactly ``puzzle_date``.

    Returns ``None`` (without caching) when NYT published no daily puzzle that
    day — the caller decides whether to snap to a neighbour or record a gap.
    """
    entry = find_available_puzzle_id(puzzle_date)
    if entry is None:
        return None

    puzzle_id = entry.get("puzzle_id")

    # Try fetching from xwordinfo first (cookie-free)
    try:
        normalized = fetch_crossword_from_xwordinfo(puzzle_date)
        if normalized is not None:
            if puzzle_id:
                normalized["external_id"] = str(puzzle_id)
            # Prefer the listing's author/title metadata when the puzzle omits them.
            normalized["author"] = normalized["author"] or normalize_text(entry.get("author"), max_length=160)
            normalized["title"] = normalized["title"] or normalize_text(entry.get("title"), max_length=120)

            source = {"id": "xwordinfo", "puzzleId": puzzle_id, "ok": True}
            return save_crossword_puzzle(
                puzzle_date=puzzle_date, normalized=normalized, status="confirmed", source=source
            )
    except Exception:  # noqa: BLE001 - fall through to NYT endpoint as safety backup
        pass

    # Fall back to NYT's authenticated endpoint
    source = {"id": "nyt-crossword", "puzzleId": puzzle_id, "ok": False}
    payload = fetch_crossword_puzzle_by_id(puzzle_id)
    normalized = normalize_crossword_payload(payload)
    if normalized["print_date"] != puzzle_date.isoformat():
        raise ValueError("Crossword publication date did not match the requested date")
    # Prefer the listing's author/title metadata when the puzzle omits them.
    normalized["author"] = normalized["author"] or normalize_text(entry.get("author"), max_length=160)
    normalized["title"] = normalized["title"] or normalize_text(entry.get("title"), max_length=120)
    source["ok"] = True
    return save_crossword_puzzle(
        puzzle_date=puzzle_date, normalized=normalized, status="confirmed", source=source
    )


def _nearest_cached_date(puzzle_date: date) -> date | None:
    """The confirmed cached date closest to ``puzzle_date`` (ties round down)."""
    target = puzzle_date.isoformat()
    with connect_game("crossword") as connection:
        below = connection.execute(
            """
            SELECT puzzle_date FROM daily_crossword
            WHERE status = 'confirmed' AND puzzle_date <= ?
            ORDER BY puzzle_date DESC LIMIT 1
            """,
            (target,),
        ).fetchone()
        above = connection.execute(
            """
            SELECT puzzle_date FROM daily_crossword
            WHERE status = 'confirmed' AND puzzle_date >= ?
            ORDER BY puzzle_date ASC LIMIT 1
            """,
            (target,),
        ).fetchone()
    candidates = [
        date.fromisoformat(row["puzzle_date"])
        for row in (below, above)
        if row is not None
    ]
    return _pick_nearest(puzzle_date, candidates)


def find_nearest_available_date(puzzle_date: date) -> date | None:
    """The published date nearest ``puzzle_date`` (ties round *down*).

    Probes the NYT listing for the closest date at or below and at or above the
    request. Falls back to the nearest confirmed date already in the cache if the
    network is unavailable.
    """
    today = get_puzzle_date()
    try:
        below = _closest_date_at_or_below(puzzle_date)
        above = _closest_date_at_or_above(puzzle_date, today)
    except Exception:  # noqa: BLE001 - network best-effort; fall back to cache
        return _nearest_cached_date(puzzle_date)

    nearest = _pick_nearest(puzzle_date, [candidate for candidate in (below, above) if candidate])
    if nearest is not None:
        return nearest
    return _nearest_cached_date(puzzle_date)


def _closest_date_at_or_below(puzzle_date: date) -> date | None:
    """The newest published date ≤ ``puzzle_date`` (widening the lookback).

    The listing is newest-first, so its first entry is always the closest date
    below regardless of the 100-result cap — only the window has to be widened
    until it contains a puzzle.
    """
    for window in NEAREST_WINDOWS_DAYS:
        start = max(CROSSWORD_FIRST_DATE, puzzle_date - timedelta(days=window))
        listing = fetch_crossword_listing(start, puzzle_date)
        if listing:
            return date.fromisoformat(listing[0]["print_date"])
        if start == CROSSWORD_FIRST_DATE:
            break
    return None


def _closest_date_at_or_above(puzzle_date: date, today: date) -> date | None:
    """The oldest published date ≥ ``puzzle_date`` (binary search).

    A widening window can't read this off the newest-first, 100-capped listing
    (a big gap before a dense region hides the true nearest), so instead binary
    search for the smallest ``d`` where ``[puzzle_date, d]`` contains a puzzle —
    that ``d`` is exactly the closest date above.
    """
    if puzzle_date > today:
        return None
    if not fetch_crossword_listing(puzzle_date, today):
        return None
    low, high = puzzle_date, today
    while low < high:
        mid = low + timedelta(days=(high - low).days // 2)
        if fetch_crossword_listing(puzzle_date, mid):
            high = mid
        else:
            low = mid + timedelta(days=1)
    return low


def _pick_nearest(target: date, candidates: list[date]) -> date | None:
    if not candidates:
        return None
    # Smallest absolute distance; on a tie the earlier (round-down) date wins.
    return min(candidates, key=lambda candidate: (abs((candidate - target).days), candidate > target))


def get_crossword_puzzle(puzzle_date: date, *, force_refresh: bool = False) -> dict[str, Any]:
    """Resolve a playable crossword for ``puzzle_date``.

    ``force_refresh`` (backfill/warm) fetches the *exact* date and raises on a
    true gap so the ledger records it. Normal serving returns a cached row with
    no network, fetches an uncached exact date, and — only for a genuine gap —
    snaps to the nearest available date.
    """
    if force_refresh:
        exact = _fetch_and_cache_exact(puzzle_date)
        if exact is None:
            raise RuntimeError("No crossword was published on this date")
        return exact

    cached = get_cached_crossword(puzzle_date)
    if cached is not None and cached["status"] == "confirmed":
        return cached

    try:
        exact = _fetch_and_cache_exact(puzzle_date)
        if exact is not None:
            return exact
    except Exception:  # noqa: BLE001 - fall through to a neighbour / cache / fallback
        exact = None

    nearest = find_nearest_available_date(puzzle_date)
    if nearest is not None and nearest != puzzle_date:
        cached_near = get_cached_crossword(nearest)
        if cached_near is not None and cached_near["status"] == "confirmed":
            return cached_near
        try:
            near = _fetch_and_cache_exact(nearest)
            if near is not None:
                return near
        except Exception:  # noqa: BLE001 - fall through to cache / fallback
            pass

    if cached is not None:
        return cached
    fallback_cached = _nearest_cached_date(puzzle_date)
    if fallback_cached is not None:
        neighbour = get_cached_crossword(fallback_cached)
        if neighbour is not None:
            return neighbour
    raise RuntimeError("Crossword is temporarily unavailable")


def warm_crossword_puzzle(puzzle_date: date) -> dict[str, Any]:
    cached = get_cached_crossword(puzzle_date)
    if cached is not None and cached["status"] == "confirmed":
        return {"confirmed": True, "status": "cached", "fetchedAt": cached["fetched_at"]}

    try:
        exact = _fetch_and_cache_exact(puzzle_date)
    except Exception as exc:  # noqa: BLE001 - recorded for diagnostics
        return {"confirmed": False, "status": "failed", "error": str(exc)}
    if exact is None:
        return {"confirmed": False, "status": "unpublished"}
    return {"confirmed": True, "status": "fetched", "fetchedAt": exact["fetched_at"]}


# --- Public views + play mechanics -----------------------------------------


def public_crossword_puzzle(puzzle: dict[str, Any]) -> dict[str, Any]:
    """The client-facing puzzle with answers stripped (server validates)."""
    public_cells = [
        None if cell is None else {"label": cell.get("label")}
        for cell in puzzle["cells"]
    ]
    return {
        "gameKey": "crossword",
        "date": puzzle["date"],
        "status": puzzle["status"],
        "title": puzzle["title"],
        "author": puzzle["author"],
        "editor": puzzle["editor"],
        "width": puzzle["width"],
        "height": puzzle["height"],
        "cells": public_cells,
        "clues": puzzle["clues"],
    }


def public_crossword_solution(puzzle: dict[str, Any]) -> dict[str, Any]:
    """The full answer grid (for reveal + post-solve display)."""
    return {
        "date": puzzle["date"],
        "width": puzzle["width"],
        "height": puzzle["height"],
        "answers": [None if cell is None else cell.get("answer") for cell in puzzle["cells"]],
    }


def normalize_crossword_entries(raw_entries: object, cell_count: int) -> list[str]:
    if not isinstance(raw_entries, list) or len(raw_entries) != cell_count:
        raise ValueError("Invalid crossword entries")
    entries: list[str] = []
    for value in raw_entries:
        if value is None:
            entries.append("")
        elif isinstance(value, str):
            entries.append(value.strip().upper())
        else:
            raise ValueError("Invalid crossword entries")
    return entries


def check_crossword(puzzle_date: date, raw_entries: object) -> dict[str, Any]:
    """Per-cell correctness for a submitted grid (never leaks the answers).

    Powers Check Square/Word/Puzzle and autocheck: the client sends its current
    letters and gets back which filled cells are right or wrong.
    """
    puzzle = get_crossword_puzzle(puzzle_date)
    cells = puzzle["cells"]
    entries = normalize_crossword_entries(raw_entries, len(cells))

    correct: list[int] = []
    incorrect: list[int] = []
    filled = 0
    open_count = 0
    for index, cell in enumerate(cells):
        if cell is None:
            continue
        open_count += 1
        entry = entries[index]
        if not entry:
            continue
        filled += 1
        if entry == str(cell.get("answer") or "").upper():
            correct.append(index)
        else:
            incorrect.append(index)

    complete = filled == open_count and open_count > 0
    return {
        "correct": correct,
        "incorrect": incorrect,
        "complete": complete,
        "solved": complete and not incorrect,
        "openCount": open_count,
    }


def validate_crossword_solution(puzzle_date: date, raw_entries: object) -> bool:
    try:
        return check_crossword(puzzle_date, raw_entries)["solved"]
    except ValueError:
        return False
