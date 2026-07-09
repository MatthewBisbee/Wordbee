#!/usr/bin/env python3
"""Diagnose The Crossword sourcing for a given date.

Run from the repo root (``fnf-wordle/``):

    python3 scripts/crossword_probe.py 2015-03-04
    python3 scripts/crossword_probe.py 1976-01-01   # a gap date -> snaps
    python3 scripts/crossword_probe.py              # today

Prints, without touching the real database, what the fetch pipeline does for the
date: the exact-date listing lookup, the nearest-available date (for gap dates
in the sparse pre-1993 era), and the board the game would actually serve. Needs
the operator's subscriber ``NYT_COOKIE`` exported for the puzzle body.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from datetime import date


def main() -> None:
    raw_date = sys.argv[1] if len(sys.argv) > 1 else None

    tmp = tempfile.mkdtemp(prefix="xw-probe-")
    os.environ.setdefault("DATABASE_PATH", os.path.join(tmp, "wordbee.sqlite"))
    os.environ.setdefault("CROSSWORD_DATABASE_PATH", os.path.join(tmp, "crossword.sqlite"))
    os.environ.setdefault("SECRET_KEY", "probe")

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from backend.app.config import load_env_file
    load_env_file()

    from backend.app.daily_answer import get_puzzle_date
    from backend.app.games import crossword as cw

    if not os.environ.get("NYT_COOKIE"):
        print("WARNING: NYT_COOKIE is not set — the puzzle body needs a subscriber cookie.\n", file=sys.stderr)

    puzzle_date = date.fromisoformat(raw_date) if raw_date else get_puzzle_date()
    today = get_puzzle_date()
    print(f"Requested date: {puzzle_date}  (today = {today})")

    print("\n== Exact-date listing ==")
    try:
        entry = cw.find_available_puzzle_id(puzzle_date)
    except Exception as exc:  # noqa: BLE001
        entry = None
        print("listing error:", exc)
    if entry is not None:
        print(f"published: puzzle_id={entry.get('puzzle_id')} author={entry.get('author')!r} title={entry.get('title')!r}")
    else:
        print("no puzzle published on this exact date")
        print("\n== Nearest available (gap snap) ==")
        nearest = cw.find_nearest_available_date(puzzle_date)
        print("nearest:", nearest, f"({abs((nearest - puzzle_date).days)} days away)" if nearest else "")

    print("\n== What the game would actually serve ==")
    served = cw.public_crossword_puzzle(cw.get_crossword_puzzle(puzzle_date))
    open_cells = sum(1 for cell in served["cells"] if cell is not None)
    print(json.dumps(
        {
            "date": served["date"],
            "status": served["status"],
            "title": served["title"],
            "author": served["author"],
            "editor": served["editor"],
            "dimensions": f"{served['width']}x{served['height']}",
            "openCells": open_cells,
            "clues": len(served["clues"]),
            "snappedFrom": puzzle_date.isoformat() if served["date"] != puzzle_date.isoformat() else None,
        },
        indent=2,
    ))


if __name__ == "__main__":
    main()
