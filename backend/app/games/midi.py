"""The Midi — NYT's 11×11-max daily crossword (subscriber-only at NYT).

Unlike The Mini, NYT exposes no free feed for the Midi's answers, so the two
sources are:

* **Daily (free, no auth)** — the reconstruction pipeline. NYT's free
  ``svc/crosswords/v2/puzzle/midi.json`` gives today's grid *dimensions* and
  metadata (but no answers), and a third-party answer site (word.tips) publishes
  today's numbered clue list with answers. ``midi_reconstruct`` recovers the
  block geometry from those, and only a *uniquely* reconstructed grid is stored —
  a wrong grid is never confirmed. This is what the warmup loop polls, so the
  daily refresh never needs the operator's cookie.
* **Backfill / past days (cookie)** — ``svc/crosswords/v6/puzzle/midi/<date>.json``
  returns any historical Midi's real grid but is subscriber-only. A one-time
  ``scripts/midi_backfill.py`` run (with ``NYT_COOKIE``) solidifies the whole
  history back to the first Midi (2026-02-25) into ``midi.sqlite``. It is also the
  fallback for any day the free reconstruction can't confirm.

Both paths reduce to the same durable board + clue shape (see ``grid_common``).
The Midi's history is dense/gapless, so no nearest-date snapping is needed.
"""
from __future__ import annotations

import os
import re
from datetime import date, datetime
from typing import Any

import requests

from ..daily_answer import get_puzzle_date
from .common import SOURCE_TIMEOUT_SECONDS, USER_AGENT, normalize_text
from .grid_common import (
    check_grid,
    get_cached_grid,
    normalize_v6_grid_payload,
    public_grid_puzzle,
    public_grid_solution,
    save_grid_puzzle,
)
from .midi_db import connect_midi
from .midi_reconstruct import build_normalized_from_grid, solve_grid


MIDI_FIRST_DATE = date(2026, 2, 25)  # the first NYT Midi

MIDI_V2_URL = "https://www.nytimes.com/svc/crosswords/v2/puzzle/midi.json"
MIDI_V6_URL = "https://www.nytimes.com/svc/crosswords/v6/puzzle/midi/{date}.json"
WORDTIPS_URL = "https://word.tips/nyt-midi-crossword-todays-hints-answers/"

_TABLE = "daily_midi"

_MONTHS = {
    m: i
    for i, m in enumerate(
        ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1
    )
}


# --- HTTP -------------------------------------------------------------------


def _headers(*, auth: bool, accept: str = "application/json") -> dict[str, str]:
    headers = {"User-Agent": USER_AGENT, "Accept": accept}
    cookie = os.environ.get("NYT_COOKIE")
    if auth and cookie:
        headers["Cookie"] = cookie
    return headers


def fetch_midi_v6(puzzle_date: date) -> dict[str, Any] | None:
    """A historical Midi via the dated subscriber endpoint (needs NYT_COOKIE)."""
    response = requests.get(
        MIDI_V6_URL.format(date=puzzle_date.isoformat()),
        headers=_headers(auth=True),
        timeout=SOURCE_TIMEOUT_SECONDS,
    )
    if response.status_code == 404:
        return None
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError("Midi payload was not an object")
    return normalize_v6_grid_payload(payload)


def fetch_midi_v2_meta() -> dict[str, Any]:
    """Today's Midi *dimensions + metadata* from the free endpoint (no answers)."""
    response = requests.get(MIDI_V2_URL, headers=_headers(auth=False), timeout=SOURCE_TIMEOUT_SECONDS)
    response.raise_for_status()
    payload = response.json()
    results = payload.get("results") if isinstance(payload, dict) else None
    if not isinstance(results, list) or not results or not isinstance(results[0], dict):
        raise ValueError("Midi v2 payload was missing results")
    result = results[0]
    meta = result.get("puzzle_meta") if isinstance(result.get("puzzle_meta"), dict) else {}
    width = int(meta.get("width") or 0)
    height = int(meta.get("height") or 0)
    print_date = str(meta.get("printDate") or result.get("print_date") or "")
    if width <= 0 or height <= 0 or not print_date:
        raise ValueError("Midi v2 metadata was incomplete")
    return {
        "width": width,
        "height": height,
        "print_date": print_date,
        "external_id": str(result.get("puzzle_id") or ""),
        "title": normalize_text(meta.get("title"), max_length=120),
        "author": normalize_text(meta.get("author"), max_length=160),
        "editor": normalize_text(meta.get("editor"), max_length=80),
    }


# --- Third-party clue list (word.tips) --------------------------------------


def _parse_wordtips_date(html: str) -> date | None:
    match = re.search(r"([A-Z][a-z]{2})[a-z]*\s+(\d{1,2}),\s+(\d{4})", html)
    if not match:
        return None
    month = _MONTHS.get(match.group(1).lower())
    if not month:
        return None
    try:
        return date(int(match.group(3)), month, int(match.group(2)))
    except ValueError:
        return None


def parse_wordtips(html: str) -> dict[str, Any]:
    """Extract the Across/Down clue numbers, answers and texts from word.tips.

    The page renders two ``data-clues`` blocks (Across then Down). Each clue is a
    number span, a clue-text ``<h3>``, and an answer grid whose letters sit in
    ``data-face="invisible"`` spans (one clean letter each).
    """
    block_starts = [m.start() for m in re.finditer(r"data-clues", html)]
    if len(block_starts) < 2:
        raise ValueError("word.tips clue blocks were missing")
    boundaries = block_starts[1:] + [len(html)]

    across: dict[int, str] = {}
    down: dict[int, str] = {}
    across_text: dict[int, str] = {}
    down_text: dict[int, str] = {}
    for block_index, (start, end) in enumerate(zip(block_starts, boundaries)):
        segment = html[start:end]
        answers = across if block_index == 0 else down
        texts = across_text if block_index == 0 else down_text
        number_matches = list(re.finditer(r'<span class="w-7[^"]*">(\d+)</span>', segment))
        for i, match in enumerate(number_matches):
            number = int(match.group(1))
            body = segment[match.end() : (number_matches[i + 1].start() if i + 1 < len(number_matches) else len(segment))]
            letters = re.findall(r'data-face="invisible"[^>]*>\s*([A-Za-z])\s*</span>', body)
            if not letters:
                continue
            answers[number] = "".join(letters).upper()
            text_match = re.search(r"<h3[^>]*><a[^>]*>(.*?)</a></h3>", body, re.S)
            texts[number] = re.sub(r"<[^>]+>", "", text_match.group(1)).strip() if text_match else ""
    if not across or not down:
        raise ValueError("word.tips clue list was empty")
    return {"across": across, "down": down, "across_text": across_text, "down_text": down_text}


def fetch_wordtips() -> dict[str, Any]:
    response = requests.get(WORDTIPS_URL, headers=_headers(auth=False, accept="text/html"), timeout=SOURCE_TIMEOUT_SECONDS)
    response.raise_for_status()
    parsed = parse_wordtips(response.text)
    parsed["date"] = _parse_wordtips_date(response.text)
    return parsed


# --- Free reconstruction ----------------------------------------------------


def reconstruct_midi_today(puzzle_date: date) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    """Rebuild today's Midi from free sources (no cookie).

    Returns ``(normalized_or_None, source)``. ``None`` means the day could not be
    *confidently* reconstructed (source/date mismatch or a non-unique grid), and
    the caller must not confirm it.
    """
    source: dict[str, Any] = {"id": "midi-reconstruct", "ok": False}
    try:
        meta = fetch_midi_v2_meta()
    except Exception as exc:  # noqa: BLE001
        source["error"] = f"dimensions: {exc}"
        return None, source
    if meta["print_date"] != puzzle_date.isoformat():
        source["error"] = "v2 date mismatch"
        source["fetchedDate"] = meta["print_date"]
        return None, source

    try:
        clues = fetch_wordtips()
    except Exception as exc:  # noqa: BLE001
        source["error"] = f"clues: {exc}"
        return None, source
    if clues["date"] is not None and clues["date"] != puzzle_date:
        source["error"] = "clue-source date mismatch"
        source["fetchedDate"] = clues["date"].isoformat()
        return None, source

    status, grid = solve_grid(clues["across"], clues["down"], meta["width"], meta["height"])
    source["reconstruct"] = status
    if status != "unique" or grid is None:
        source["error"] = f"reconstruction {status}"
        return None, source

    built = build_normalized_from_grid(
        grid,
        meta["width"],
        meta["height"],
        clues["across"],
        clues["down"],
        clues["across_text"],
        clues["down_text"],
    )
    source["ok"] = True
    source["clueSource"] = "word.tips"
    normalized = {
        "external_id": meta["external_id"],
        "print_date": meta["print_date"],
        "title": meta["title"],
        "author": meta["author"],
        "editor": meta["editor"],
        "width": meta["width"],
        "height": meta["height"],
        "cells": built["cells"],
        "clues": built["clues"],
    }
    return normalized, source


# --- Fetch + cache ----------------------------------------------------------


def _fetch_and_cache(puzzle_date: date, *, allow_auth: bool) -> dict[str, Any] | None:
    today = get_puzzle_date()

    if puzzle_date >= today:
        normalized, source = reconstruct_midi_today(puzzle_date)
        if normalized is not None and normalized["print_date"] == puzzle_date.isoformat():
            return save_grid_puzzle(
                connect_midi, _TABLE, puzzle_date=puzzle_date, normalized=normalized, status="confirmed", source=source
            )

    if allow_auth:
        normalized = fetch_midi_v6(puzzle_date)
        if normalized is not None and normalized["print_date"] == puzzle_date.isoformat():
            return save_grid_puzzle(
                connect_midi,
                _TABLE,
                puzzle_date=puzzle_date,
                normalized=normalized,
                status="confirmed",
                source={"id": "nyt-midi-v6", "ok": True},
            )
    return None


def get_midi_puzzle(puzzle_date: date, *, force_refresh: bool = False) -> dict[str, Any]:
    """Resolve a playable Midi for ``puzzle_date`` (local-first)."""
    if force_refresh:
        fetched = _fetch_and_cache(puzzle_date, allow_auth=True)
        if fetched is None:
            raise RuntimeError("No Midi was published on this date")
        return fetched

    cached = get_cached_grid(connect_midi, _TABLE, puzzle_date)
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
    raise RuntimeError("Midi is temporarily unavailable")


def warm_midi_puzzle(puzzle_date: date) -> dict[str, Any]:
    """Daily warmup — free reconstruction only, so the poller never needs the cookie.

    A day that can't be uniquely reconstructed is reported unconfirmed (never
    stored wrong); the operator's cookie backfill fills those in.
    """
    cached = get_cached_grid(connect_midi, _TABLE, puzzle_date)
    if cached is not None and cached["status"] == "confirmed":
        return {"confirmed": True, "status": "cached", "fetchedAt": cached["fetched_at"]}

    try:
        fetched = _fetch_and_cache(puzzle_date, allow_auth=False)
    except Exception as exc:  # noqa: BLE001 - recorded for diagnostics
        return {"confirmed": False, "status": "failed", "error": str(exc)}
    if fetched is None:
        return {"confirmed": False, "status": "unconfirmed"}
    return {"confirmed": True, "status": "fetched", "fetchedAt": fetched["fetched_at"]}


# --- Public views + play mechanics -----------------------------------------


def public_midi_puzzle(puzzle: dict[str, Any]) -> dict[str, Any]:
    return public_grid_puzzle("midi", puzzle)


def public_midi_solution(puzzle: dict[str, Any]) -> dict[str, Any]:
    return public_grid_solution(puzzle)


def check_midi(puzzle_date: date, raw_entries: object) -> dict[str, Any]:
    return check_grid(get_midi_puzzle(puzzle_date), raw_entries)


def validate_midi_solution(puzzle_date: date, raw_entries: object) -> bool:
    try:
        return check_midi(puzzle_date, raw_entries)["solved"]
    except ValueError:
        return False
