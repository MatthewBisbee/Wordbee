#!/usr/bin/env python3
"""One-shot backfill of the Spelling Bee archive into ``spellingbee.sqlite``.

This is a thin, Spelling-Bee-only wrapper around the shared archive backfiller
(``scripts/backfill_archive.py``) for the "download every past puzzle once" job.
Ongoing daily puzzles are added automatically by the app's warmup thread and by
on-play caching, so this only needs to be run once (and re-run occasionally to
fill any gaps).

Run from the repo root (``fnf-wordle/``):

    python3 scripts/spellingbee_backfill.py                 # all history
    python3 scripts/spellingbee_backfill.py --from 2024-01-01 --to 2024-03-01
    python3 scripts/spellingbee_backfill.py --status         # just print coverage
    python3 scripts/spellingbee_backfill.py --pace 3         # gentler pacing

Past days come from nytbee.com (complete coverage, not rate-limited), so a single
pass should confirm essentially every day back to the 2018-05-09 launch. It is
safe to stop (Ctrl-C) and re-run — confirmed days are skipped.
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import date


def _repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill the Spelling Bee archive.")
    parser.add_argument("--from", dest="start", help="Start date YYYY-MM-DD.")
    parser.add_argument("--to", dest="end", help="End date YYYY-MM-DD.")
    parser.add_argument("--pace", type=float, default=1.0, help="Seconds between requests.")
    parser.add_argument("--force", action="store_true", help="Re-download confirmed days too.")
    parser.add_argument("--status", action="store_true", help="Print coverage and exit.")
    args = parser.parse_args()

    sys.path.insert(0, _repo_root())
    from backend.app.config import load_env_file
    load_env_file()

    os.environ.setdefault("WORDBEE_MULTIGAME_WARMUP_ENABLED", "0")

    from backend.app.backfill import archive_coverage, backfill_game
    from backend.app.db import init_db

    # Ensure the shared archive_status ledger exists before it is read/written.
    init_db()

    if args.status:
        coverage = archive_coverage("spellingbee")
        print("Spelling Bee coverage:")
        for key, value in coverage.items():
            print(f"  {key}: {value}")
        return

    start = date.fromisoformat(args.start) if args.start else None
    end = date.fromisoformat(args.end) if args.end else None

    def on_progress(_game: str, day: date, status: str, note: str) -> None:
        marker = {"confirmed": "OK", "generated": "~~", "missing": "--", "error": "!!"}.get(status, "??")
        detail = f" ({note})" if status != "confirmed" else ""
        print(f"[{marker}] {day.isoformat()} {status}{detail}")

    counts = backfill_game(
        "spellingbee",
        start=start,
        end=end,
        pace_seconds=args.pace,
        force=args.force,
        on_progress=on_progress,
    )

    print("\nDone. Totals:")
    for status, count in sorted(counts.items()):
        print(f"  {status}: {count}")
    coverage = archive_coverage("spellingbee")
    print(f"Coverage: {coverage['confirmed']}/{coverage['totalDays']} days confirmed.")


if __name__ == "__main__":
    main()
