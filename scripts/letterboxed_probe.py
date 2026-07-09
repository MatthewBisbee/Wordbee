#!/usr/bin/env python3
"""Diagnose Letter Boxed puzzle sourcing for a given date.

Run from the repo root (``fnf-wordle/``):

    python3 scripts/letterboxed_probe.py 2023-12-05
    python3 scripts/letterboxed_probe.py            # today

It prints, without touching the real database, exactly what the fetch pipeline
does for that date: whether the live/archive fetch succeeded, which Wayback
snapshots were tried, the parsed board, and (on failure) why it fell back.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from datetime import date


def main() -> None:
    raw_date = sys.argv[1] if len(sys.argv) > 1 else None

    # Keep the probe fully isolated from real data.
    tmp = tempfile.mkdtemp(prefix="lb-probe-")
    os.environ.setdefault("DATABASE_PATH", os.path.join(tmp, "wordbee.sqlite"))
    os.environ.setdefault("LETTERBOXED_DATABASE_PATH", os.path.join(tmp, "letterboxed.sqlite"))
    os.environ.setdefault("SECRET_KEY", "probe")

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from backend.app.config import load_env_file
    load_env_file()

    from backend.app.daily_answer import get_puzzle_date
    from backend.app.games import letterboxed as lb

    puzzle_date = date.fromisoformat(raw_date) if raw_date else get_puzzle_date()
    today = get_puzzle_date()
    print(f"Requested date: {puzzle_date}  (today = {today})")

    if puzzle_date >= today:
        print("\n== Live page fetch ==")
        result = lb.fetch_letterboxed_source()
    else:
        print("\n== Internet Archive fetch ==")
        result = lb.fetch_letterboxed_source_for_date(puzzle_date)

    print("ok:", result.get("ok"))
    print("source:", json.dumps(result.get("source", {}), indent=2)[:2000])
    if result.get("ok"):
        print("parsed date:", result["puzzle_date"])
        print("sides:", result["sides"])
        print("ourSolution:", result["our_solution"], "par:", result["par"])
        print("dictionary size:", len(result["dictionary"]))
    else:
        print("\n-> Fetch failed; get_letterboxed_puzzle would serve the bundled fallback board.")

    print("\n== What the game would actually serve ==")
    served = lb.public_letterboxed_puzzle(lb.get_letterboxed_puzzle(puzzle_date, force_refresh=True))
    print(json.dumps(served, indent=2))
    print("\nstatus =", served["status"], "(confirmed = real NYT puzzle, generated = fallback)")


if __name__ == "__main__":
    main()
