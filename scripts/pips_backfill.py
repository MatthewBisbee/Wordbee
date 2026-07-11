#!/usr/bin/env python3
"""Solidify the entire NYT Pips history into ``pips.sqlite``.

Pips has a dense, gapless, **public** dated endpoint
(``svc/pips/v1/<date>.json``) from the very first puzzle (2025-08-18), and each
date carries all three difficulties at once. So this just walks every calendar
day and downloads each date once — no subscriber cookie required (unlike the
crossword family). The daily *serving* path caches new days automatically; this
script exists to fill the back-catalogue in one pass.

    python3 scripts/pips_backfill.py                 # download everything
    python3 scripts/pips_backfill.py --from 2026-01-01
    python3 scripts/pips_backfill.py --status        # coverage summary
    python3 scripts/pips_backfill.py --pace 0.5      # gentler pacing
    python3 scripts/pips_backfill.py --force         # re-download confirmed

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
    parser = argparse.ArgumentParser(description="Download the NYT Pips archive.")
    parser.add_argument("--from", dest="start", help="Oldest date to fetch (YYYY-MM-DD).")
    parser.add_argument("--to", dest="end", help="Newest date to fetch (YYYY-MM-DD).")
    parser.add_argument("--pace", type=float, default=0.4, help="Seconds between requests.")
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
    from backend.app.games import pips

    init_db()  # the shared archive_status ledger lives in wordbee.sqlite

    if args.status:
        with connect_game("pips") as connection:
            row = connection.execute(
                "SELECT COUNT(DISTINCT puzzle_date) AS days, COUNT(*) AS n, "
                "MIN(puzzle_date) AS lo, MAX(puzzle_date) AS hi "
                "FROM daily_pips WHERE status = 'confirmed'"
            ).fetchone()
        print("Pips coverage in pips.sqlite:")
        print(f"  confirmed days: {row['days']}   puzzles: {row['n']}")
        print(f"  earliest: {row['lo']}   latest: {row['hi']}")
        return

    start = date.fromisoformat(args.start) if args.start else pips.PIPS_FIRST_DATE
    end = date.fromisoformat(args.end) if args.end else get_puzzle_date()
    start = max(start, pips.PIPS_FIRST_DATE)

    counts = {"downloaded": 0, "skipped": 0, "missing": 0, "error": 0}
    current = end
    while current >= start:
        _fetch_one(pips, record_archive_status, current, args.force, args.pace, counts)
        current -= timedelta(days=1)

    print("\nDone. Totals:")
    for label, value in counts.items():
        print(f"  {label}: {value}")


def _fetch_one(pips, record_archive_status, puzzle_date, force, pace, counts) -> None:
    if not force:
        cached = {
            difficulty: pips.get_cached_pips(puzzle_date, difficulty)
            for difficulty in pips.PIPS_DIFFICULTIES
        }
        if all(row is not None and row["status"] == "confirmed" for row in cached.values()):
            counts["skipped"] += 1
            return

    try:
        fetched = pips.fetch_pips_source(puzzle_date)
        if not fetched["ok"]:
            error = fetched["source"].get("error", "")
            if "404" in error or "Not Found" in error:
                counts["missing"] += 1
                record_archive_status("pips", puzzle_date, "missing", "no puzzle", 3)
                return
            raise RuntimeError(error or "fetch failed")

        for difficulty_key, puzzle in fetched["puzzles"].items():
            pips.save_pips_puzzle(
                puzzle_date=puzzle_date,
                difficulty=difficulty_key,
                editor=fetched["editor"],
                puzzle=puzzle,
                status="confirmed",
                source=fetched["source"],
            )
        record_archive_status("pips", puzzle_date, "confirmed", "backfill", 3)
        counts["downloaded"] += 1
        sizes = " ".join(
            f"{d}:{len(fetched['puzzles'][d]['dominoes'])}dom"
            for d in ("easy", "medium", "hard")
        )
        print(f"[OK ] {puzzle_date}  {sizes}")
    except Exception as exc:  # noqa: BLE001 - recorded and kept going
        record_archive_status("pips", puzzle_date, "error", str(exc), 3)
        counts["error"] += 1
        print(f"[ERR] {puzzle_date}: {exc}", file=sys.stderr)

    if pace > 0:
        time.sleep(pace)


if __name__ == "__main__":
    main()
