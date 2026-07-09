#!/usr/bin/env python3
"""Solidify the entire NYT Crossword history into ``crossword.sqlite``.

The Crossword's archive reaches back to the first puzzle (1942-02-15) and is
gapless from 1993-11-21. Rather than probe every calendar day (most of the sparse
pre-1993 era has none), this enumerates the archive efficiently by paging the
dated **listing** newest-first in 100-result windows, then downloads each
puzzle's grid + clues once. Serving is local-first afterwards, so a full run
makes the game source-independent.

The puzzle body is subscriber-only, so export your logged-in cookie first:

    export NYT_COOKIE="NYT-S=...; nyt-a=...; ..."   # from your browser devtools
    python3 scripts/crossword_backfill.py                 # download everything
    python3 scripts/crossword_backfill.py --from 2020-01-01
    python3 scripts/crossword_backfill.py --status        # coverage summary
    python3 scripts/crossword_backfill.py --pace 0.5      # gentler pacing
    python3 scripts/crossword_backfill.py --force         # re-download confirmed

Run from the repo root (``fnf-wordle/``). Safe to stop and re-run — already
downloaded dates are skipped unless ``--force`` is given.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import date, timedelta


def _repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main() -> None:
    parser = argparse.ArgumentParser(description="Download the NYT Crossword archive.")
    parser.add_argument("--from", dest="start", help="Oldest date to fetch (YYYY-MM-DD).")
    parser.add_argument("--to", dest="end", help="Newest date to fetch (YYYY-MM-DD).")
    parser.add_argument("--pace", type=float, default=0.8, help="Seconds between requests.")
    parser.add_argument("--force", action="store_true", help="Re-download confirmed puzzles too.")
    parser.add_argument("--status", action="store_true", help="Print coverage and exit.")
    args = parser.parse_args()

    sys.path.insert(0, _repo_root())
    from backend.app.config import load_env_file
    load_env_file()

    os.environ.setdefault("WORDBEE_MULTIGAME_WARMUP_ENABLED", "0")
    os.environ.setdefault("SECRET_KEY", "backfill")

    from backend.app.daily_answer import get_puzzle_date
    from backend.app.db import connect_game, init_db
    from backend.app.backfill import record_archive_status
    from backend.app.games import crossword as cw

    # Ensure the shared archive_status ledger table exists before recording to it.
    init_db()

    if args.status:
        with connect_game("crossword") as connection:
            row = connection.execute(
                "SELECT COUNT(*) AS n, MIN(puzzle_date) AS lo, MAX(puzzle_date) AS hi "
                "FROM daily_crossword WHERE status = 'confirmed'"
            ).fetchone()
        print("The Crossword coverage in crossword.sqlite:")
        print(f"  confirmed puzzles: {row['n']}")
        print(f"  earliest: {row['lo']}   latest: {row['hi']}")
        return

    if not os.environ.get("NYT_COOKIE"):
        print(
            "WARNING: NYT_COOKIE is not set. The Crossword body is subscriber-only; "
            "downloads will fail without a logged-in cookie.\n",
            file=sys.stderr,
        )

    start = date.fromisoformat(args.start) if args.start else cw.CROSSWORD_FIRST_DATE
    end = date.fromisoformat(args.end) if args.end else get_puzzle_date()
    start = max(start, cw.CROSSWORD_FIRST_DATE)

    counts = {"downloaded": 0, "skipped": 0, "error": 0}

    # Page the listing newest-first: each window returns the ≤100 newest puzzles
    # at or below ``window_end``; stepping ``window_end`` to just below the oldest
    # of each batch walks the whole archive without probing empty days.
    window_end = end
    seen: set[str] = set()
    while window_end >= start:
        try:
            listing = cw.fetch_crossword_listing(start, window_end)
        except Exception as exc:  # noqa: BLE001
            print(f"[!!] listing {start}..{window_end} failed: {exc}", file=sys.stderr)
            break
        if not listing:
            break

        oldest = window_end
        for entry in listing:
            print_date = str(entry.get("print_date") or "")
            if not print_date or print_date in seen:
                continue
            seen.add(print_date)
            oldest = min(oldest, date.fromisoformat(print_date))
            _fetch_one(cw, record_archive_status, entry, print_date, args.force, args.pace, counts)

        next_end = oldest - timedelta(days=1)
        if next_end >= window_end:  # guard against a non-advancing window
            break
        window_end = next_end

    print("\nDone. Totals:")
    for label, value in counts.items():
        print(f"  {label}: {value}")


def _fetch_one(cw, record_archive_status, entry, print_date, force, pace, counts) -> None:
    puzzle_date = date.fromisoformat(print_date)
    if not force:
        cached = cw.get_cached_crossword(puzzle_date)
        if cached is not None and cached["status"] == "confirmed":
            counts["skipped"] += 1
            return

    try:
        puzzle = cw.get_crossword_puzzle(puzzle_date, force_refresh=True)
        record_archive_status("crossword", puzzle_date, "confirmed", "backfill", 1)
        counts["downloaded"] += 1
        print(f"[OK ] {print_date}  {puzzle['width']}x{puzzle['height']}  {puzzle['author']}")
    except Exception as exc:  # noqa: BLE001 - recorded and kept going
        record_archive_status("crossword", puzzle_date, "error", str(exc), 1)
        counts["error"] += 1
        print(f"[ERR] {print_date}: {exc}", file=sys.stderr)

    if pace > 0:
        time.sleep(pace)


if __name__ == "__main__":
    main()
