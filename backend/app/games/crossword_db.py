"""Dedicated database for The Crossword.

A day's crossword is a full grid (15×15 weekdays, 21×21 Sundays) plus its clue
list — bulky, wholly game-specific data with a very deep history (the archive
reaches back to the very first NYT crossword in 1942). Like Letter Boxed,
Spelling Bee and Tiles, it keeps its raw puzzles in their own SQLite file so the
shared ``wordbee.sqlite`` stays small; family stats/attempts/results still flow
through the shared multigame tables so the aggregates match the other games.
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from ..db import PROJECT_ROOT, get_database_path


SCHEMA = """
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
CREATE INDEX IF NOT EXISTS idx_daily_crossword_fetched_at ON daily_crossword (fetched_at);
"""


def get_crossword_database_path() -> Path:
    configured_path = os.environ.get("CROSSWORD_DATABASE_PATH")
    if configured_path:
        path = Path(configured_path)
        if not path.is_absolute():
            path = PROJECT_ROOT / path
        return path

    # Keep the Crossword database beside the main one so a test override of
    # DATABASE_PATH (e.g. a temp file) also relocates this away from real data.
    return get_database_path().parent / "crossword.sqlite"


def connect_crossword() -> sqlite3.Connection:
    database_path = get_crossword_database_path()
    database_path.parent.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    # The schema is self-managed here (rather than in the shared init_db) so the
    # separate database stays fully decoupled from wordbee.sqlite.
    connection.executescript(SCHEMA)
    return connection
