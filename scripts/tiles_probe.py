#!/usr/bin/env python3
"""Diagnose Tiles palette sourcing and board generation.

Run from the repo root (``fnf-wordle/``):

    python3 scripts/tiles_probe.py                 # today's board + default palette
    python3 scripts/tiles_probe.py 2024-08-15      # a specific date's board + palette
    python3 scripts/tiles_probe.py --palette soho  # try to fetch one palette's art

Without touching the real database, it prints what the pipeline does: whether a
palette fetch succeeded (needs NYT_COOKIE for anything but brighton), the resolved
palette for the date, and a summary of the generated 30-tile board (including a
sanity check that the board is solvable — every layer variant appears in pairs).
Set NYT_COOKIE to exercise the authenticated palette fetch.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from collections import Counter
from datetime import date


def main() -> None:
    parser = argparse.ArgumentParser(description="Probe Tiles sourcing.")
    parser.add_argument("date", nargs="?", help="Puzzle date YYYY-MM-DD (default: today).")
    parser.add_argument("--palette", help="Fetch and inspect a single palette by filename.")
    args = parser.parse_args()

    tmp = tempfile.mkdtemp(prefix="tiles-probe-")
    os.environ.setdefault("DATABASE_PATH", os.path.join(tmp, "wordbee.sqlite"))
    os.environ.setdefault("TILES_DATABASE_PATH", os.path.join(tmp, "tiles.sqlite"))
    os.environ.setdefault("SECRET_KEY", "probe")

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from backend.app.config import load_env_file
    load_env_file()

    from backend.app.daily_answer import get_puzzle_date
    from backend.app.games import tiles

    if args.palette:
        print(f"== Fetching palette '{args.palette}' from the live page ==")
        if not os.environ.get("NYT_COOKIE"):
            print("(NYT_COOKIE not set — only 'brighton' will succeed anonymously)")
        fetched = tiles.fetch_tiles_palette(args.palette)
        if fetched is None:
            print("-> fetch failed (unavailable or not a subscriber)")
        else:
            print("-> ok:", fetched["filename"], "-", fetched["display_name"], "by", fetched["created_by"])
            print("   colors:", fetched["bg_color"], fetched["font_color"], fetched["selection_color"])
            print("   layers:", [len(x) for x in fetched["layers"]], "z:", fetched["z_layer"])
            print("   svg bytes:", len(fetched["svg"]))
        return

    puzzle_date = date.fromisoformat(args.date) if args.date else get_puzzle_date()
    print(f"Requested date: {puzzle_date}  (today = {get_puzzle_date()})")

    palette_meta = tiles.resolve_default_palette(puzzle_date, force_refresh=True)
    board = tiles.generate_board(puzzle_date, palette_meta)
    print(f"\n== Board ({len(board)} tiles, {tiles.BOARD_COLS}x{tiles.BOARD_ROWS}) ==")
    solvable = True
    num_layers = len(board[0]["layers"]) if board else 0
    for layer in range(num_layers):
        counts = Counter(tile["layers"][layer] for tile in board)
        if any(value % 2 for value in counts.values()):
            solvable = False
    print("all layers appear in pairs (solvable):", solvable)
    print("first three tiles:", json.dumps(board[:3]))

    served = tiles.public_tiles_puzzle(tiles.get_tiles_puzzle(puzzle_date, force_refresh=True))
    palette = served["palette"]
    print("\n== Resolved palette ==")
    print("filename:", palette["filename"], "-", palette["displayName"], "by", palette["createdBy"])
    print("colors:", palette["bgColor"], palette["fontColor"], palette["selectionColor"])
    print("status:", served["status"], "(confirmed = real NYT art, generated = bundled fallback)")
    print("switcher catalogue:", [p["filename"] for p in served["palettes"]])


if __name__ == "__main__":
    main()
