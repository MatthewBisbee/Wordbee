#!/usr/bin/env python3
"""Diagnose Spelling Bee puzzle sourcing for a given date.

Run from the repo root (``fnf-wordle/``):

    python3 scripts/spellingbee_probe.py 2023-04-15
    python3 scripts/spellingbee_probe.py            # today

It prints, without touching the real database, exactly what the fetch pipeline
does for that date: whether the live/nytbee/archive fetch succeeded, the derived
board (centre letter, outer letters, pangrams), the answer count, and (on
failure) why it fell back to the bundled board.
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
    tmp = tempfile.mkdtemp(prefix="sb-probe-")
    os.environ.setdefault("DATABASE_PATH", os.path.join(tmp, "wordbee.sqlite"))
    os.environ.setdefault("SPELLINGBEE_DATABASE_PATH", os.path.join(tmp, "spellingbee.sqlite"))
    os.environ.setdefault("SECRET_KEY", "probe")

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from backend.app.config import load_env_file
    load_env_file()

    from backend.app.daily_answer import get_puzzle_date
    from backend.app.games import spellingbee as sb

    puzzle_date = date.fromisoformat(raw_date) if raw_date else get_puzzle_date()
    today = get_puzzle_date()
    print(f"Requested date: {puzzle_date}  (today = {today})")

    if puzzle_date >= today:
        print("\n== Live page fetch ==")
        result = sb.fetch_spellingbee_source()
    else:
        print("\n== nytbee.com / Internet Archive fetch ==")
        result = sb.fetch_spellingbee_source_for_date(puzzle_date)

    print("ok:", result.get("ok"))
    print("source:", json.dumps(result.get("source", {}), indent=2)[:2000])
    if result.get("ok"):
        print("parsed date:", result["puzzle_date"])
        print("center:", result["center_letter"], "outer:", result["outer_letters"])
        print("pangrams:", result["pangrams"])
        print("answers:", len(result["answers"]))
    else:
        print("\n-> Fetch failed; get_spellingbee_puzzle would serve the bundled fallback board.")

    print("\n== What the game would actually serve ==")
    served = sb.public_spellingbee_puzzle(sb.get_spellingbee_puzzle(puzzle_date, force_refresh=True))
    print(json.dumps(served, indent=2))
    print("\nstatus =", served["status"], "(confirmed = real NYT puzzle, generated = fallback)")


if __name__ == "__main__":
    main()
