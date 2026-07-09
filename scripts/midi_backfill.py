#!/usr/bin/env python3
"""Solidify the entire NYT Midi history into ``midi.sqlite``.

The Midi launched 2026-02-25 with a dense, gapless daily history, so this walks
every calendar day and downloads each puzzle once via the dated subscriber
endpoint (``svc/crosswords/v6/puzzle/midi/<date>.json``).

The Midi's daily *serving* path is free (it reconstructs the grid from a
third-party clue list — see ``app/games/midi.py``), but the historical archive is
subscriber-only, so this backfill needs your cookie. It also backstops the ~1 in
100 days the free reconstruction can't uniquely resolve. Export the cookie first:

    export NYT_COOKIE="NYT-S=...; nyt-a=...; ..."   # from your browser devtools
    python3 scripts/midi_backfill.py                     # download everything
    python3 scripts/midi_backfill.py --from 2026-06-01
    python3 scripts/midi_backfill.py --status           # coverage summary
    python3 scripts/midi_backfill.py --force            # re-download confirmed

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
    parser = argparse.ArgumentParser(description="Download the NYT Midi archive.")
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
    from backend.app.games import midi

    init_db()  # the shared archive_status ledger lives in wordbee.sqlite

    if args.status:
        with connect_game("midi") as connection:
            row = connection.execute(
                "SELECT COUNT(*) AS n, MIN(puzzle_date) AS lo, MAX(puzzle_date) AS hi "
                "FROM daily_midi WHERE status = 'confirmed'"
            ).fetchone()
        print("The Midi coverage in midi.sqlite:")
        print(f"  confirmed puzzles: {row['n']}")
        print(f"  earliest: {row['lo']}   latest: {row['hi']}")
        return

    if not os.environ.get("NYT_COOKIE"):
        print(
            "WARNING: NYT_COOKIE is not set. The Midi archive is subscriber-only; "
            "downloads will fail without a logged-in cookie.\n",
            file=sys.stderr,
        )

    start = date.fromisoformat(args.start) if args.start else midi.MIDI_FIRST_DATE
    end = date.fromisoformat(args.end) if args.end else get_puzzle_date()
    start = max(start, midi.MIDI_FIRST_DATE)

    counts = {"downloaded": 0, "skipped": 0, "missing": 0, "error": 0}
    current = end
    while current >= start:
        _fetch_one(midi, record_archive_status, current, args.force, args.pace, counts)
        current -= timedelta(days=1)

    print("\nDone. Totals:")
    for label, value in counts.items():
        print(f"  {label}: {value}")


def _fetch_one(midi, record_archive_status, puzzle_date, force, pace, counts) -> None:
    if not force:
        cached = midi.get_cached_grid(midi.connect_midi, midi._TABLE, puzzle_date)
        if cached is not None and cached["status"] == "confirmed":
            counts["skipped"] += 1
            return

    try:
        normalized = midi.fetch_midi_v6(puzzle_date)
        if normalized is None:
            counts["missing"] += 1
            record_archive_status("midi", puzzle_date, "missing", "no puzzle", 1)
            return
        if normalized["print_date"] != puzzle_date.isoformat():
            raise ValueError(f"publication date mismatch ({normalized['print_date']})")
        midi.save_grid_puzzle(
            midi.connect_midi,
            midi._TABLE,
            puzzle_date=puzzle_date,
            normalized=normalized,
            status="confirmed",
            source={"id": "nyt-midi-v6", "ok": True},
        )
        record_archive_status("midi", puzzle_date, "confirmed", "backfill", 1)
        counts["downloaded"] += 1
        print(f"[OK ] {puzzle_date}  {normalized['width']}x{normalized['height']}  {normalized['author']}")
    except Exception as exc:  # noqa: BLE001 - recorded and kept going
        record_archive_status("midi", puzzle_date, "error", str(exc), 1)
        counts["error"] += 1
        print(f"[ERR] {puzzle_date}: {exc}", file=sys.stderr)

    if pace > 0:
        time.sleep(pace)


if __name__ == "__main__":
    main()
