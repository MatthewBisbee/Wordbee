#!/usr/bin/env python3
"""Convert the doshea/nyt_crosswords GitHub archive into Wordbee's crossword.sqlite.

Runs over all year/month/day.json files in 'External References/CrosswordsToConvert',
parses their grid and clues, normalizes them, and inserts/updates them in the local database.
Also records the backfill status in the main wordbee.sqlite database ledger.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
from datetime import date, datetime
from pathlib import Path

def _repo_root() -> Path:
    return Path(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def main() -> None:
    parser = argparse.ArgumentParser(description="Convert and import NYT crosswords from GitHub archive.")
    parser.add_argument("--force", action="store_true", help="Overwrite already confirmed puzzles.")
    args = parser.parse_args()

    root = _repo_root()
    sys.path.insert(0, str(root))

    # Path to external crosswords directory
    crosswords_dir = root / "External References" / "CrosswordsToConvert"
    if not crosswords_dir.exists():
        print(f"Error: Crosswords source directory not found at: {crosswords_dir}", file=sys.stderr)
        sys.exit(1)

    # Database paths
    crossword_db_path = root / "data" / "crossword.sqlite"
    wordbee_db_path = root / "data" / "wordbee.sqlite"

    print(f"Reading crosswords from: {crosswords_dir}")
    print(f"Writing to: {crossword_db_path}")
    print(f"Updating ledger in: {wordbee_db_path}")

    # Ensure data directory exists
    crossword_db_path.parent.mkdir(parents=True, exist_ok=True)

    # Connect to databases
    conn_cw = sqlite3.connect(crossword_db_path)
    conn_cw.row_factory = sqlite3.Row

    conn_wb = sqlite3.connect(wordbee_db_path)
    conn_wb.row_factory = sqlite3.Row

    # Ensure tables exist
    # 1. crossword
    conn_cw.execute("""
    CREATE TABLE IF NOT EXISTS daily_crossword (
      puzzle_date TEXT PRIMARY KEY,
      external_id TEXT,
      title TEXT,
      author TEXT,
      editor TEXT,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      cells_json TEXT NOT NULL,
      clues_json TEXT NOT NULL,
      status TEXT NOT NULL,
      source_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    """)
    conn_cw.execute("CREATE INDEX IF NOT EXISTS idx_daily_crossword_fetched_at ON daily_crossword (fetched_at);")

    # 2. wordbee ledger
    conn_wb.execute("""
    CREATE TABLE IF NOT EXISTS archive_status (
      game_key TEXT NOT NULL,
      puzzle_date TEXT NOT NULL,
      variant TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      note TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT NOT NULL,
      PRIMARY KEY (game_key, puzzle_date, variant)
    );
    """)
    conn_wb.execute("CREATE INDEX IF NOT EXISTS idx_archive_status_game_status ON archive_status (game_key, status);")

    # Get already confirmed dates to skip if not forcing
    existing_dates = set()
    if not args.force:
        cursor = conn_cw.execute("SELECT puzzle_date FROM daily_crossword WHERE status = 'confirmed'")
        for row in cursor.fetchall():
            existing_dates.add(row["puzzle_date"])
        print(f"Skipping {len(existing_dates)} puzzles already confirmed in database (use --force to overwrite).")

    # Collect all JSON files
    json_files = sorted(crosswords_dir.glob("**/*.json"))
    total_files = len(json_files)
    print(f"Found {total_files} JSON files to process.")

    counts = {"imported": 0, "skipped": 0, "error": 0}
    now = datetime.now().astimezone().isoformat()

    t_start = datetime.now()

    # Process files
    for idx, filepath in enumerate(json_files, 1):
        # Extract date from path structure (e.g. /1995/01/01.json)
        try:
            day = int(filepath.stem)
            month = int(filepath.parent.name)
            year = int(filepath.parent.name) # Wait! This is wrong! filepath.parent.parent.name is the year!
            # Let's fix this in the code below
        except (ValueError, IndexError):
            pass

        # Wait, let's extract date carefully:
        try:
            parts = filepath.parts
            # The structure is .../CrosswordsToConvert/YYYY/MM/DD.json
            # Find CrosswordsToConvert index
            idx_ctc = parts.index("CrosswordsToConvert")
            year = int(parts[idx_ctc + 1])
            month = int(parts[idx_ctc + 2])
            day = int(filepath.stem)
            puzzle_date = date(year, month, day)
            date_str = puzzle_date.isoformat()
        except (ValueError, IndexError):
            print(f"[ERR] Could not parse date from filepath: {filepath}", file=sys.stderr)
            counts["error"] += 1
            continue

        if date_str in existing_dates:
            counts["skipped"] += 1
            continue

        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)

            # Dimensions
            width = int(data["size"]["cols"])
            height = int(data["size"]["rows"])

            grid = data["grid"]
            gridnums = data["gridnums"]

            if len(grid) != width * height or len(gridnums) != width * height:
                raise ValueError(f"Grid or gridnums size mismatch: expected {width * height}, got {len(grid)} and {len(gridnums)}")

            # Convert cells
            cells = []
            for i, char in enumerate(grid):
                if char == "." or char is None:
                    cells.append(None)
                else:
                    label = str(gridnums[i]) if gridnums[i] != 0 else None
                    cells.append({
                        "answer": str(char).strip().upper(),
                        "label": label
                    })

            # Trace clues
            across_clues = []
            down_clues = []
            for i, char in enumerate(grid):
                if char == "." or char is None:
                    continue
                row = i // width
                col = i % width

                # Across clue start
                is_across_start = (col == 0 or grid[i - 1] == ".")
                if is_across_start:
                    label = gridnums[i]
                    if label != 0:
                        cells_in_clue = []
                        c = col
                        while c < width and grid[row * width + c] != ".":
                            cells_in_clue.append(row * width + c)
                            c += 1
                        across_clues.append({
                            "label": str(label),
                            "direction": "across",
                            "cells": cells_in_clue,
                            "text": ""
                        })

                # Down clue start
                is_down_start = (row == 0 or grid[i - width] == ".")
                if is_down_start:
                    label = gridnums[i]
                    if label != 0:
                        cells_in_clue = []
                        r = row
                        while r < height and grid[r * width + col] != ".":
                            cells_in_clue.append(r * width + col)
                            r += 1
                        down_clues.append({
                            "label": str(label),
                            "direction": "down",
                            "cells": cells_in_clue,
                            "text": ""
                        })

            clues = across_clues + down_clues

            # Parse clue text lookup
            across_lookup = {}
            down_lookup = {}

            # Helper to strip digit prefix, e.g. "1. Auto accessory" -> "Auto accessory"
            def clean_clue_text(t: str) -> str:
                m = re.match(r"^(\d+)\.?\s*(.*)$", t)
                return m.group(2).strip() if m else t.strip()

            for clue_str in data["clues"].get("across", []):
                if not clue_str:
                    continue
                m = re.match(r"^(\d+)\.?\s*(.*)$", clue_str)
                if m:
                    across_lookup[m.group(1)] = m.group(2).strip()

            for clue_str in data["clues"].get("down", []):
                if not clue_str:
                    continue
                m = re.match(r"^(\d+)\.?\s*(.*)$", clue_str)
                if m:
                    down_lookup[m.group(1)] = m.group(2).strip()

            # Assign text to traced clues
            for clue in clues:
                lbl = clue["label"]
                if clue["direction"] == "across":
                    clue["text"] = across_lookup.get(lbl, "")
                else:
                    clue["text"] = down_lookup.get(lbl, "")

            # Normalize metadata
            def normalize_field(val: object, max_len: int) -> str:
                if not isinstance(val, str):
                    return ""
                return " ".join(val.strip().split())[:max_len]

            title = normalize_field(data.get("title"), 120)
            author = normalize_field(data.get("author"), 160)
            editor = normalize_field(data.get("editor"), 80)
            external_id = str(data.get("id") or data.get("id2") or "")

            # Source payload
            source_payload = {
                "id": "nyt-crossword-github-import",
                "puzzleId": data.get("id"),
                "ok": True
            }

            # Insert into daily_crossword
            conn_cw.execute(
                """
                INSERT INTO daily_crossword (
                  puzzle_date, external_id, title, author, editor, width, height,
                  cells_json, clues_json, status, source_json, fetched_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(puzzle_date) DO UPDATE SET
                  external_id = excluded.external_id,
                  title = excluded.title,
                  author = excluded.author,
                  editor = excluded.editor,
                  width = excluded.width,
                  height = excluded.height,
                  cells_json = excluded.cells_json,
                  clues_json = excluded.clues_json,
                  status = excluded.status,
                  source_json = excluded.source_json,
                  fetched_at = excluded.fetched_at,
                  updated_at = excluded.updated_at
                """,
                (
                    date_str,
                    external_id,
                    title,
                    author,
                    editor,
                    width,
                    height,
                    json.dumps(cells, separators=(",", ":")),
                    json.dumps(clues, separators=(",", ":")),
                    "confirmed",
                    json.dumps(source_payload, separators=(",", ":")),
                    now,
                    now
                )
            )

            # Insert into archive_status ledger
            conn_wb.execute(
                """
                INSERT INTO archive_status (
                  game_key, puzzle_date, variant, status, note, attempts, last_attempt_at
                )
                VALUES ('crossword', ?, '', 'confirmed', 'github-import', 1, ?)
                ON CONFLICT(game_key, puzzle_date, variant) DO UPDATE SET
                  status = excluded.status,
                  note = excluded.note,
                  attempts = excluded.attempts,
                  last_attempt_at = excluded.last_attempt_at
                """,
                (date_str, now)
            )

            counts["imported"] += 1

        except Exception as exc:
            print(f"[ERR] Failed to process {filepath}: {exc}", file=sys.stderr)
            counts["error"] += 1

        if idx % 1000 == 0 or idx == total_files:
            print(f"Progress: {idx}/{total_files} processed... (imported={counts['imported']}, skipped={counts['skipped']}, error={counts['error']})")

    # Commit transactions
    conn_cw.commit()
    conn_wb.commit()

    conn_cw.close()
    conn_wb.close()

    t_end = datetime.now()
    duration = (t_end - t_start).total_seconds()

    print(f"\nImport Completed in {duration:.2f} seconds.")
    print("Totals:")
    for label, val in counts.items():
        print(f"  {label}: {val}")

if __name__ == "__main__":
    main()
