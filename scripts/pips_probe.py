#!/usr/bin/env python3
"""Diagnose NYT Pips sourcing for a given date.

Run from the repo root (``fnf-wordle/``):

    python3 scripts/pips_probe.py 2025-09-01
    python3 scripts/pips_probe.py            # today

Prints, without touching the real database, what the fetch pipeline returns for
the date: the three difficulties, each puzzle's board size / domino count /
region-constraint mix, and whether NYT's own solution validates through the same
server-side checker the game uses. No subscriber cookie required — the Pips
endpoint is public.
"""
from __future__ import annotations

import os
import sys
import tempfile
from collections import Counter
from datetime import date


def main() -> None:
    raw_date = sys.argv[1] if len(sys.argv) > 1 else None

    tmp = tempfile.mkdtemp(prefix="pips-probe-")
    os.environ.setdefault("DATABASE_PATH", os.path.join(tmp, "wordbee.sqlite"))
    os.environ.setdefault("PIPS_DATABASE_PATH", os.path.join(tmp, "pips.sqlite"))
    os.environ.setdefault("SECRET_KEY", "probe")
    os.environ.setdefault("WORDBEE_MULTIGAME_WARMUP_ENABLED", "0")

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from backend.app.config import load_env_file
    load_env_file()

    from backend.app.daily_answer import get_puzzle_date
    from backend.app.games import pips

    puzzle_date = get_puzzle_date(raw_date)
    print(f"Probing Pips for {puzzle_date.isoformat()}\n")

    fetched = pips.fetch_pips_source(puzzle_date)
    if not fetched["ok"]:
        print("FETCH FAILED:", fetched["source"].get("error"))
        return

    print(f"editor: {fetched['editor']}")
    for difficulty in ("easy", "medium", "hard"):
        puzzle = fetched["puzzles"][difficulty]
        region_mix = Counter(region["type"] for region in puzzle["regions"])
        saved = pips.save_pips_puzzle(
            puzzle_date=puzzle_date,
            difficulty=difficulty,
            editor=fetched["editor"],
            puzzle=puzzle,
            status="confirmed",
            source=fetched["source"],
        )
        valid = pips.validate_pips_solution(puzzle_date, difficulty, saved["solution"])
        print(
            f"  {difficulty:<6} {puzzle['rows']}x{puzzle['cols']} board  "
            f"{len(puzzle['dominoes'])} dominoes  "
            f"regions={dict(region_mix)}  by {puzzle['constructors']}  "
            f"solution valid={valid}"
        )


if __name__ == "__main__":
    main()
