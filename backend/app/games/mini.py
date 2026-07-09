"""The Mini — NYT's free daily 5×5 crossword.

Sourcing is deliberately split so the **daily** pipeline needs no subscriber
cookie (like Connections/Strands/Spelling Bee):

* **Daily (free, no auth)** — ``svc/crosswords/v2/puzzle/mini.json`` returns
  *today's* Mini with its full answer grid. The Mini is free, so NYT serves the
  answers to anyone. This is what the warmup loop polls.
* **Backfill / past days (cookie)** — ``svc/crosswords/v6/puzzle/mini/<date>.json``
  returns any historical Mini's grid but is subscriber-only. A one-time
  ``scripts/mini_backfill.py`` run (with ``NYT_COOKIE``) solidifies the whole
  history back to the first Mini (2014-08-21) into ``mini.sqlite``, after which
  serving is local-first and source-independent.

Both endpoints reduce to the same durable board + clue shape The Crossword uses
(see ``grid_common``). The Mini's history is dense/gapless, so a requested date
always has a real puzzle — no nearest-date snapping is needed.
"""
from __future__ import annotations

import os
from datetime import date, datetime
from typing import Any

import requests

from ..daily_answer import get_puzzle_date
from .common import SOURCE_TIMEOUT_SECONDS, USER_AGENT, normalize_text
from .grid_common import (
    check_grid,
    get_cached_grid,
    normalize_grid_entries,
    normalize_v6_grid_payload,
    public_grid_puzzle,
    public_grid_solution,
    save_grid_puzzle,
)
from .mini_db import connect_mini


MINI_FIRST_DATE = date(2014, 8, 21)  # the first NYT Mini

MINI_V2_URL = "https://www.nytimes.com/svc/crosswords/v2/puzzle/mini.json"
MINI_V6_URL = "https://www.nytimes.com/svc/crosswords/v6/puzzle/mini/{date}.json"

_TABLE = "daily_mini"


# --- HTTP -------------------------------------------------------------------


def _headers(*, auth: bool) -> dict[str, str]:
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    cookie = os.environ.get("NYT_COOKIE")
    if auth and cookie:
        headers["Cookie"] = cookie
    return headers


def fetch_mini_v2_today() -> dict[str, Any]:
    """Today's Mini from the free public endpoint (no cookie needed)."""
    response = requests.get(MINI_V2_URL, headers=_headers(auth=False), timeout=SOURCE_TIMEOUT_SECONDS)
    response.raise_for_status()
    payload = response.json()
    results = payload.get("results") if isinstance(payload, dict) else None
    if not isinstance(results, list) or not results or not isinstance(results[0], dict):
        raise ValueError("Mini v2 payload was missing results")
    return normalize_v2_mini_result(results[0])


def fetch_mini_v6(puzzle_date: date) -> dict[str, Any] | None:
    """A historical Mini via the dated subscriber endpoint (needs NYT_COOKIE).

    Returns ``None`` when NYT published no Mini that day (HTTP 404).
    """
    response = requests.get(
        MINI_V6_URL.format(date=puzzle_date.isoformat()),
        headers=_headers(auth=True),
        timeout=SOURCE_TIMEOUT_SECONDS,
    )
    if response.status_code == 404:
        return None
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError("Mini payload was not an object")
    return normalize_v6_grid_payload(payload)


# --- v2 normalization -------------------------------------------------------


def normalize_v2_mini_result(result: dict[str, Any]) -> dict[str, Any]:
    """Reduce NYT's v2 Mini JSON to the same board + clues shape as the v6 path.

    The v2 payload gives a flat ``layout`` (0=block, 1=open), an ``answers`` list
    (letter per cell, ``None`` for blocks) and grouped ``clues`` (``{"A":[...],
    "D":[...]}`` where each entry's ``clueStart``/``clueEnd`` are cell indices).
    Cell numbers are recovered from the clue starts.
    """
    meta = result.get("puzzle_meta") if isinstance(result.get("puzzle_meta"), dict) else {}
    data = result.get("puzzle_data") if isinstance(result.get("puzzle_data"), dict) else {}

    width = int(meta.get("width") or 0)
    height = int(meta.get("height") or 0)
    answers = data.get("answers")
    layout = data.get("layout")
    if width <= 0 or height <= 0 or not isinstance(answers, list) or len(answers) != width * height:
        raise ValueError("Mini v2 grid was invalid")

    raw_clues = data.get("clues")
    if not isinstance(raw_clues, dict):
        raise ValueError("Mini v2 clues were missing")

    # A cell is numbered iff it starts an Across and/or Down entry.
    labels: dict[int, str] = {}
    clues: list[dict[str, Any]] = []
    for group, direction, step in (("A", "across", 1), ("D", "down", width)):
        for clue in raw_clues.get(group) or []:
            if not isinstance(clue, dict):
                continue
            number = clue.get("clueNum")
            start = clue.get("clueStart")
            end = clue.get("clueEnd")
            if not isinstance(number, int) or not isinstance(start, int) or not isinstance(end, int):
                raise ValueError("Mini v2 clue was invalid")
            cell_indices = list(range(start, end + 1, step))
            labels.setdefault(start, str(number))
            clues.append(
                {
                    "label": str(number),
                    "direction": direction,
                    "cells": cell_indices,
                    "text": normalize_text(clue.get("value"), max_length=300),
                }
            )
    if not clues:
        raise ValueError("Mini v2 clues were empty")

    cells: list[dict[str, Any] | None] = []
    for index in range(width * height):
        answer = answers[index]
        is_block = answer is None or (isinstance(layout, list) and index < len(layout) and layout[index] == 0)
        if is_block:
            cells.append(None)
        else:
            cells.append({"answer": str(answer or "").upper(), "label": labels.get(index)})

    author = normalize_text(meta.get("author"), max_length=160)
    if not author:
        authors = result.get("authors")
        if isinstance(authors, list):
            author = normalize_text(", ".join(str(name) for name in authors), max_length=160)

    return {
        "external_id": str(result.get("puzzle_id") or ""),
        "print_date": str(meta.get("printDate") or result.get("print_date") or ""),
        "title": normalize_text(meta.get("title"), max_length=120),
        "author": author,
        "editor": normalize_text(meta.get("editor"), max_length=80),
        "width": width,
        "height": height,
        "cells": cells,
        "clues": clues,
    }


# --- Fetch + cache ----------------------------------------------------------


def _fetch_and_cache(puzzle_date: date, *, allow_auth: bool) -> dict[str, Any] | None:
    """Fetch and cache the Mini for ``puzzle_date`` (free v2 first, then v6)."""
    today = get_puzzle_date()

    if puzzle_date >= today:
        try:
            normalized = fetch_mini_v2_today()
        except Exception:  # noqa: BLE001 - fall through to the authed path
            normalized = None
        if normalized is not None and normalized["print_date"] == puzzle_date.isoformat():
            return save_grid_puzzle(
                connect_mini,
                _TABLE,
                puzzle_date=puzzle_date,
                normalized=normalized,
                status="confirmed",
                source={"id": "nyt-mini-v2", "ok": True},
            )

    if allow_auth:
        normalized = fetch_mini_v6(puzzle_date)
        if normalized is not None and normalized["print_date"] == puzzle_date.isoformat():
            return save_grid_puzzle(
                connect_mini,
                _TABLE,
                puzzle_date=puzzle_date,
                normalized=normalized,
                status="confirmed",
                source={"id": "nyt-mini-v6", "ok": True},
            )
    return None


def get_mini_puzzle(puzzle_date: date, *, force_refresh: bool = False) -> dict[str, Any]:
    """Resolve a playable Mini for ``puzzle_date`` (local-first)."""
    if force_refresh:
        fetched = _fetch_and_cache(puzzle_date, allow_auth=True)
        if fetched is None:
            raise RuntimeError("No Mini was published on this date")
        return fetched

    cached = get_cached_grid(connect_mini, _TABLE, puzzle_date)
    if cached is not None and cached["status"] == "confirmed":
        return cached

    try:
        fetched = _fetch_and_cache(puzzle_date, allow_auth=True)
        if fetched is not None:
            return fetched
    except Exception:  # noqa: BLE001 - fall through to any cache
        pass

    if cached is not None:
        return cached
    raise RuntimeError("Mini is temporarily unavailable")


def warm_mini_puzzle(puzzle_date: date) -> dict[str, Any]:
    """Daily warmup — free v2 only, so the poller never needs the cookie."""
    cached = get_cached_grid(connect_mini, _TABLE, puzzle_date)
    if cached is not None and cached["status"] == "confirmed":
        return {"confirmed": True, "status": "cached", "fetchedAt": cached["fetched_at"]}

    try:
        fetched = _fetch_and_cache(puzzle_date, allow_auth=False)
    except Exception as exc:  # noqa: BLE001 - recorded for diagnostics
        return {"confirmed": False, "status": "failed", "error": str(exc)}
    if fetched is None:
        return {"confirmed": False, "status": "unpublished"}
    return {"confirmed": True, "status": "fetched", "fetchedAt": fetched["fetched_at"]}


# --- Public views + play mechanics -----------------------------------------


def public_mini_puzzle(puzzle: dict[str, Any]) -> dict[str, Any]:
    return public_grid_puzzle("mini", puzzle)


def public_mini_solution(puzzle: dict[str, Any]) -> dict[str, Any]:
    return public_grid_solution(puzzle)


def check_mini(puzzle_date: date, raw_entries: object) -> dict[str, Any]:
    return check_grid(get_mini_puzzle(puzzle_date), raw_entries)


def validate_mini_solution(puzzle_date: date, raw_entries: object) -> bool:
    try:
        return check_mini(puzzle_date, raw_entries)["solved"]
    except ValueError:
        return False
