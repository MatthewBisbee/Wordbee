"""Dedicated database for Spelling Bee raw puzzle data.

Each Spelling Bee day ships a full list of official answers (dozens of words)
plus the seven-letter board and its pangrams. That raw play-through data is
game-specific and bulky enough that it lives in its own SQLite file rather than
bloating the shared ``wordbee.sqlite`` — mirroring how Letter Boxed stores its
per-day dictionary. Family stats/attempts/results still flow through the shared
multigame tables, so the aggregates match the other games.
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from ..db import PROJECT_ROOT, get_database_path


SCHEMA = """
CREATE TABLE IF NOT EXISTS daily_spellingbee (
  puzzle_date TEXT PRIMARY KEY,
  external_id TEXT,
  editor TEXT,
  center_letter TEXT NOT NULL,
  outer_letters_json TEXT NOT NULL,
  valid_letters_json TEXT NOT NULL,
  pangrams_json TEXT NOT NULL,
  answers_json TEXT NOT NULL,
  display_date TEXT,
  status TEXT NOT NULL,
  source_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
"""


def get_spellingbee_database_path() -> Path:
    configured_path = os.environ.get("SPELLINGBEE_DATABASE_PATH")
    if configured_path:
        path = Path(configured_path)
        if not path.is_absolute():
            path = PROJECT_ROOT / path
        return path

    # Keep the Spelling Bee database beside the main one so a test override of
    # DATABASE_PATH (e.g. a temp file) also relocates this away from real data.
    return get_database_path().parent / "spellingbee.sqlite"


def connect_spellingbee() -> sqlite3.Connection:
    database_path = get_spellingbee_database_path()
    database_path.parent.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    # The schema is self-managed here (rather than in the shared init_db) so the
    # separate database stays fully decoupled from wordbee.sqlite.
    connection.executescript(SCHEMA)
    return connection
