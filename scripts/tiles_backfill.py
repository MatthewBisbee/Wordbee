#!/usr/bin/env python3
"""One-shot capture of the NYT Tiles art palettes into ``tiles.sqlite``.

Tiles has no per-day puzzle to download — a day's board is generated locally and
deterministically (see ``backend/app/games/tiles.py``). The only durable data is
the artwork: a fixed, small set of designer **palettes** (SVG symbol sets + three
theme colours). This script captures them once so every day renders offline, and
can be re-run to pick up palettes NYT adds later (the "new puzzles" analog).

Tiles is a subscriber-only game: an anonymous request only ever returns the
default "brighton" palette (which is also bundled). To capture the rest, export
your logged-in NYT session cookie first:

    export NYT_COOKIE="NYT-S=...; nyt-a=...; ..."   # from your browser devtools
    python3 scripts/tiles_backfill.py                # capture every palette
    python3 scripts/tiles_backfill.py --status       # list captured vs. catalogue
    python3 scripts/tiles_backfill.py --pace 3       # gentler pacing
    python3 scripts/tiles_backfill.py --force        # re-capture confirmed palettes

Run from the repo root (``fnf-wordle/``). Safe to stop and re-run — palettes
already captured from the publisher are skipped unless ``--force`` is given.
"""
from __future__ import annotations

import argparse
import os
import sys
import time


def _repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main() -> None:
    parser = argparse.ArgumentParser(description="Capture the NYT Tiles art palettes.")
    parser.add_argument("--pace", type=float, default=1.5, help="Seconds between requests.")
    parser.add_argument("--force", action="store_true", help="Re-capture confirmed palettes too.")
    parser.add_argument("--status", action="store_true", help="Print capture coverage and exit.")
    args = parser.parse_args()

    sys.path.insert(0, _repo_root())
    from backend.app.config import load_env_file
    load_env_file()

    os.environ.setdefault("WORDBEE_MULTIGAME_WARMUP_ENABLED", "0")

    from backend.app.games.tiles import (
        PALETTE_ORDER,
        discover_palette_catalog,
        ensure_palette,
        get_cached_palette,
        list_palette_catalog,
    )

    if args.status:
        available = {row["filename"] for row in list_palette_catalog()}
        confirmed = {
            name
            for name in PALETTE_ORDER
            if (cached := get_cached_palette(name)) is not None and cached["status"] == "confirmed"
        }
        print("Tiles palette coverage:")
        for name in PALETTE_ORDER:
            state = "confirmed" if name in confirmed else ("bundled" if name in available else "missing")
            print(f"  [{state:9}] {name}")
        print(f"\n{len(confirmed)}/{len(PALETTE_ORDER)} palettes captured from the publisher.")
        return

    if not os.environ.get("NYT_COOKIE"):
        print(
            "WARNING: NYT_COOKIE is not set. Only the free default palette (brighton) "
            "can be captured; the rest need a logged-in subscriber cookie.\n",
            file=sys.stderr,
        )

    # Prefer NYT's advertised catalogue (so newly-added palettes are picked up);
    # fall back to the known fixed order if the discovery request fails.
    try:
        catalog = [entry["filename"] for entry in discover_palette_catalog()]
    except Exception as exc:  # noqa: BLE001 - fall back to the static order
        print(f"Could not discover the live catalogue ({exc}); using the built-in order.")
        catalog = list(PALETTE_ORDER)
    # De-duplicate while keeping order, unioning in any known names.
    seen: set[str] = set()
    filenames = [name for name in [*catalog, *PALETTE_ORDER] if not (name in seen or seen.add(name))]

    counts = {"confirmed": 0, "fallback": 0, "missing": 0}
    for filename in filenames:
        existing = get_cached_palette(filename)
        if not args.force and existing is not None and existing["status"] == "confirmed":
            print(f"[OK  ] {filename} (already captured)")
            counts["confirmed"] += 1
            continue

        palette = ensure_palette(filename, allow_fetch=True, force_refresh=args.force)
        if palette is None:
            print(f"[--  ] {filename} (unavailable)")
            counts["missing"] += 1
        elif palette["filename"] == filename and palette["status"] == "confirmed":
            print(f"[OK  ] {filename} captured from the publisher")
            counts["confirmed"] += 1
        else:
            print(f"[~~  ] {filename} not available (served {palette['filename']} fallback)")
            counts["fallback"] += 1

        if args.pace > 0:
            time.sleep(args.pace)

    print("\nDone. Totals:")
    for status, count in sorted(counts.items()):
        print(f"  {status}: {count}")


if __name__ == "__main__":
    main()
