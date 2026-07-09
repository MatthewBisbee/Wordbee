#!/usr/bin/env python3
"""Solidify the entire NYT Mini history into ``mini.sqlite``.

The Mini's archive is dense and gapless from the first Mini (2014-08-21), so this
just walks every calendar day and downloads each puzzle once via the dated
subscriber endpoint (``svc/crosswords/v6/puzzle/mini/<date>.json``). The daily
*serving* path is free (the v2 public endpoint), but the historical archive is
subscriber-only, so export your logged-in cookie first:

    export NYT_COOKIE="NYT-S=...; nyt-a=...; ..."   # from your browser devtools
    python3 scripts/mini_backfill.py                      # download everything
    python3 scripts/mini_backfill.py --from 2020-01-01
    python3 scripts/mini_backfill.py --status            # coverage summary
    python3 scripts/mini_backfill.py --pace 0.5          # gentler pacing
    python3 scripts/mini_backfill.py --force             # re-download confirmed

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
    parser = argparse.ArgumentParser(description="Download the NYT Mini archive.")
    parser.add_argument("--from", dest="start", help="Oldest date to fetch (YYYY-MM-DD).")
    parser.add_argument("--to", dest="end", help="Newest date to fetch (YYYY-MM-DD).")
    parser.add_argument("--pace", type=float, default=0.5, help="Seconds between requests.")
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
    from backend.app.games import mini

    init_db()  # the shared archive_status ledger lives in wordbee.sqlite

    if args.status:
        with connect_game("mini") as connection:
            row = connection.execute(
                "SELECT COUNT(*) AS n, MIN(puzzle_date) AS lo, MAX(puzzle_date) AS hi "
                "FROM daily_mini WHERE status = 'confirmed'"
            ).fetchone()
        print("The Mini coverage in mini.sqlite:")
        print(f"  confirmed puzzles: {row['n']}")
        print(f"  earliest: {row['lo']}   latest: {row['hi']}")
        return

    if not os.environ.get("NYT_COOKIE"):
        print(
            "WARNING: NYT_COOKIE is not set. The Mini archive is subscriber-only; "
            "downloads will fail without a logged-in cookie.\n",
            file=sys.stderr,
        )

    start = date.fromisoformat(args.start) if args.start else mini.MINI_FIRST_DATE
    end = date.fromisoformat(args.end) if args.end else get_puzzle_date()
    start = max(start, mini.MINI_FIRST_DATE)

    counts = {"downloaded": 0, "skipped": 0, "missing": 0, "error": 0}
    current = end
    while current >= start:
        _fetch_one(mini, record_archive_status, current, args.force, args.pace, counts)
        current -= timedelta(days=1)

    print("\nDone. Totals:")
    for label, value in counts.items():
        print(f"  {label}: {value}")


def _fetch_one(mini, record_archive_status, puzzle_date, force, pace, counts) -> None:
    if not force:
        cached = mini.get_cached_grid(mini.connect_mini, mini._TABLE, puzzle_date)
        if cached is not None and cached["status"] == "confirmed":
            counts["skipped"] += 1
            return

    try:
        normalized = mini.fetch_mini_v6(puzzle_date)
        if normalized is None:
            counts["missing"] += 1
            record_archive_status("mini", puzzle_date, "missing", "no puzzle", 1)
            return
        if normalized["print_date"] != puzzle_date.isoformat():
            raise ValueError(f"publication date mismatch ({normalized['print_date']})")
        mini.save_grid_puzzle(
            mini.connect_mini,
            mini._TABLE,
            puzzle_date=puzzle_date,
            normalized=normalized,
            status="confirmed",
            source={"id": "nyt-mini-v6", "ok": True},
        )
        record_archive_status("mini", puzzle_date, "confirmed", "backfill", 1)
        counts["downloaded"] += 1
        print(f"[OK ] {puzzle_date}  {normalized['width']}x{normalized['height']}  {normalized['author']}")
    except Exception as exc:  # noqa: BLE001 - recorded and kept going
        record_archive_status("mini", puzzle_date, "error", str(exc), 1)
        counts["error"] += 1
        print(f"[ERR] {puzzle_date}: {exc}", file=sys.stderr)

    if pace > 0:
        time.sleep(pace)


if __name__ == "__main__":
    main()
