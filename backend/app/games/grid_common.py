"""Shared grid-puzzle helpers for The Mini and The Midi.

The Mini and Midi are small NYT crosswords: a rectangular grid of block/open
cells plus a numbered Across/Down clue list — the exact durable shape The
Crossword already caches (``cells`` of ``{answer,label}``|None + ``clues`` of
``{label,direction,cells,text}``). This module holds the game-agnostic pieces the
two new games share: normalizing NYT's v6 puzzle JSON, DB save/get/serialize, the
answer-stripped public view, and per-cell server-side checking. The Crossword
keeps its own copies (it predates this and carries extra history/snapping logic),
so it is intentionally left untouched.

Answers never leave the server: the public puzzle carries only cell labels; the
``/check`` route returns which filled cells are right/wrong; the ``/reveal`` route
returns the full answer grid.
"""
from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any, Callable

from .common import normalize_text


def normalize_v6_grid_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Reduce NYT's v6 puzzle JSON to the durable board + clues we cache.

    Identical in shape to The Crossword's normalizer — the Mini/Midi use the same
    ``svc/crosswords/v6/puzzle/...`` body (``body[0].cells`` + ``body[0].clues``).
    """
    bodies = payload.get("body")
    if not isinstance(bodies, list) or not bodies or not isinstance(bodies[0], dict):
        raise ValueError("Grid body was missing")
    body = bodies[0]

    dimensions = body.get("dimensions")
    if not isinstance(dimensions, dict):
        raise ValueError("Grid dimensions were missing")
    width = int(dimensions.get("width") or 0)
    height = int(dimensions.get("height") or 0)
    raw_cells = body.get("cells")
    if width <= 0 or height <= 0 or not isinstance(raw_cells, list) or len(raw_cells) != width * height:
        raise ValueError("Grid was invalid")

    cells: list[dict[str, Any] | None] = []
    for cell in raw_cells:
        if not isinstance(cell, dict) or "answer" not in cell:
            cells.append(None)  # a block ({}) — nothing to solve here
            continue
        answer = str(cell.get("answer") or "").upper()
        label = cell.get("label")
        cells.append({"answer": answer, "label": str(label) if label is not None else None})

    raw_clues = body.get("clues")
    if not isinstance(raw_clues, list) or not raw_clues:
        raise ValueError("Grid clues were missing")
    clues: list[dict[str, Any]] = []
    for clue in raw_clues:
        if not isinstance(clue, dict):
            raise ValueError("Grid clue was invalid")
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

    constructors = payload.get("constructors")
    author = ", ".join(str(name) for name in constructors) if isinstance(constructors, list) else ""

    return {
        "external_id": str(payload.get("id") or ""),
        "print_date": str(payload.get("publicationDate") or ""),
        "title": normalize_text(payload.get("title"), max_length=120),
        "author": normalize_text(author, max_length=160),
        "editor": normalize_text(payload.get("editor"), max_length=80),
        "width": width,
        "height": height,
        "cells": cells,
        "clues": clues,
    }


def serialize_grid_row(row) -> dict[str, Any]:
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


def get_cached_grid(connect: Callable[[], Any], table: str, puzzle_date: date) -> dict[str, Any] | None:
    with connect() as connection:
        row = connection.execute(
            f"""
            SELECT puzzle_date, external_id, title, author, editor, width, height,
                   cells_json, clues_json, status, source_json, fetched_at, updated_at
            FROM {table}
            WHERE puzzle_date = ?
            """,
            (puzzle_date.isoformat(),),
        ).fetchone()
    return serialize_grid_row(row) if row else None


def save_grid_puzzle(
    connect: Callable[[], Any],
    table: str,
    *,
    puzzle_date: date,
    normalized: dict[str, Any],
    status: str,
    source: dict[str, Any],
) -> dict[str, Any]:
    now = datetime.now().astimezone().isoformat()
    with connect() as connection:
        connection.execute(
            f"""
            INSERT INTO {table} (
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

    cached = get_cached_grid(connect, table, puzzle_date)
    if cached is None:
        raise RuntimeError("Unable to cache grid puzzle")
    return cached


def public_grid_puzzle(game_key: str, puzzle: dict[str, Any]) -> dict[str, Any]:
    """The client-facing puzzle with answers stripped (server validates)."""
    public_cells = [
        None if cell is None else {"label": cell.get("label")}
        for cell in puzzle["cells"]
    ]
    return {
        "gameKey": game_key,
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


def public_grid_solution(puzzle: dict[str, Any]) -> dict[str, Any]:
    """The full answer grid (for reveal + post-solve display)."""
    return {
        "date": puzzle["date"],
        "width": puzzle["width"],
        "height": puzzle["height"],
        "answers": [None if cell is None else cell.get("answer") for cell in puzzle["cells"]],
    }


def normalize_grid_entries(raw_entries: object, cell_count: int) -> list[str]:
    if not isinstance(raw_entries, list) or len(raw_entries) != cell_count:
        raise ValueError("Invalid grid entries")
    entries: list[str] = []
    for value in raw_entries:
        if value is None:
            entries.append("")
        elif isinstance(value, str):
            entries.append(value.strip().upper())
        else:
            raise ValueError("Invalid grid entries")
    return entries


def check_grid(puzzle: dict[str, Any], raw_entries: object) -> dict[str, Any]:
    """Per-cell correctness for a submitted grid (never leaks the answers)."""
    cells = puzzle["cells"]
    entries = normalize_grid_entries(raw_entries, len(cells))

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
