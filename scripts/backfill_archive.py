#!/usr/bin/env python3
"""Download every available past puzzle into the local database.

Run from the repo root (``fnf-wordle/``). It is safe to stop (Ctrl-C) and re-run
— confirmed days are skipped, and missing/generated days are retried so gaps fill
in as Internet Archive coverage improves.

    python3 scripts/backfill_archive.py                 # every game, all history
    python3 scripts/backfill_archive.py --game sudoku   # one game
    python3 scripts/backfill_archive.py --from 2024-01-01 --to 2024-03-01
    python3 scripts/backfill_archive.py --pace 3        # gentler on rate limits
    python3 scripts/backfill_archive.py --status         # just print coverage

Wordle / Connections / Strands come from dated NYT endpoints (fast, complete).
Spelling Bee has no dated endpoint but is recovered from nytbee.com (complete,
un-throttled), so it also fills in fast. Sudoku / Letter Boxed rely partly on the
Internet Archive, which rate-limits — expect those to be slower and to need a
re-run or two to fill in. Total on-disk size is tens of MB, nowhere near any GB
budget.
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import date


def _repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _fmt_size(num_bytes: int) -> str:
    size = float(num_bytes)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} GB"


def _db_sizes() -> list[tuple[str, int]]:
    from backend.app.db import get_database_path
    from backend.app.games.letterboxed_db import get_letterboxed_database_path
    from backend.app.games.spellingbee_db import get_spellingbee_database_path

    sizes = []
    for path in (
        get_database_path(),
        get_letterboxed_database_path(),
        get_spellingbee_database_path(),
    ):
        try:
            sizes.append((str(path), path.stat().st_size))
        except OSError:
            sizes.append((str(path), 0))
    return sizes


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill the local puzzle archive.")
    parser.add_argument("--game", default="all", help="Game key or 'all' (default).")
    parser.add_argument("--from", dest="start", help="Start date YYYY-MM-DD.")
    parser.add_argument("--to", dest="end", help="End date YYYY-MM-DD.")
    parser.add_argument("--pace", type=float, default=1.5, help="Seconds between requests.")
    parser.add_argument("--force", action="store_true", help="Re-download confirmed days too.")
    parser.add_argument("--status", action="store_true", help="Print coverage and exit.")
    args = parser.parse_args()

    sys.path.insert(0, _repo_root())
    from backend.app.config import load_env_file
    load_env_file()

    from backend.app.backfill import (
        ARCHIVE_GAME_KEYS,
        archive_coverage,
        backfill_game,
    )
    from backend.app.db import init_db

    init_db()

    games = ARCHIVE_GAME_KEYS if args.game == "all" else [args.game]
    for game_key in games:
        if game_key not in ARCHIVE_GAME_KEYS:
            parser.error(f"Unknown game '{game_key}'. Choose from: {', '.join(ARCHIVE_GAME_KEYS)} or 'all'.")

    if args.status:
        _print_coverage(games, archive_coverage)
        return

    start = date.fromisoformat(args.start) if args.start else None
    end = date.fromisoformat(args.end) if args.end else None

    def on_progress(game_key: str, puzzle_date: date, status: str, note: str) -> None:
        marker = {"confirmed": "OK ", "generated": "gen", "missing": "--", "error": "ERR"}.get(status, "?")
        detail = f"  {note}" if status in {"error"} else ""
        print(f"  [{marker}] {game_key:11s} {puzzle_date.isoformat()}{detail}", flush=True)

    for game_key in games:
        print(f"\n=== {game_key} ===", flush=True)
        try:
            counts = backfill_game(
                game_key,
                start=start,
                end=end,
                pace_seconds=args.pace,
                force=args.force,
                on_progress=on_progress,
            )
        except KeyboardInterrupt:
            print("\nInterrupted — progress saved; re-run to resume.")
            break
        print(f"  -> {dict(counts)}", flush=True)

    print("\n=== Coverage ===")
    _print_coverage(games, archive_coverage)

    print("\n=== Local database size ===")
    total = 0
    for path, size in _db_sizes():
        total += size
        print(f"  {_fmt_size(size):>10}  {path}")
    print(f"  {_fmt_size(total):>10}  total")


def _print_coverage(games, archive_coverage) -> None:
    for game_key in games:
        coverage = archive_coverage(game_key)
        print(
            f"  {game_key:11s} {coverage['confirmed']:>5}/{coverage['totalDays']:<5} confirmed"
            f"  | generated {coverage['generated']}  missing {coverage['missing']}"
            f"  error {coverage['error']}  remaining {coverage['remaining']}"
            f"  (since {coverage['firstDate']})"
        )


if __name__ == "__main__":
    main()
