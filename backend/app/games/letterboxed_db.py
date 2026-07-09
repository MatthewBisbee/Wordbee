"""Dedicated database for Letter Boxed raw puzzle data.

Letter Boxed puzzles ship with a full per-day validation ``dictionary`` (often a
few thousand words) plus the board and NYT's own solution. That raw play-through
data is bulky and game-specific, so it lives in its own SQLite file rather than
bloating the shared ``wordbee.sqlite``. Family stats/attempts/results still flow
through the shared multigame tables, so the aggregates match the other games.
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from ..db import PROJECT_ROOT, get_database_path


SCHEMA = """
CREATE TABLE IF NOT EXISTS daily_letterboxed (
  puzzle_date TEXT PRIMARY KEY,
  external_id TEXT,
  editor TEXT,
  sides_json TEXT NOT NULL,
  our_solution_json TEXT NOT NULL,
  par INTEGER NOT NULL,
  dictionary_json TEXT NOT NULL,
  display_date TEXT,
  status TEXT NOT NULL,
  source_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
"""


def get_letterboxed_database_path() -> Path:
    configured_path = os.environ.get("LETTERBOXED_DATABASE_PATH")
    if configured_path:
        path = Path(configured_path)
        if not path.is_absolute():
            path = PROJECT_ROOT / path
        return path

    # Keep the Letter Boxed database beside the main one so a test override of
    # DATABASE_PATH (e.g. a temp file) also relocates this away from real data.
    return get_database_path().parent / "letterboxed.sqlite"


def connect_letterboxed() -> sqlite3.Connection:
    database_path = get_letterboxed_database_path()
    database_path.parent.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    # The schema is self-managed here (rather than in the shared init_db) so the
    # separate database stays fully decoupled from wordbee.sqlite.
    connection.executescript(SCHEMA)
    return connection
