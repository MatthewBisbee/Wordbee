"""Dedicated database for The Midi.

Like The Crossword, a day's puzzle is a full grid plus its clue list, kept in its
own SQLite file (``midi.sqlite``) so the shared ``wordbee.sqlite`` stays small.
Family stats/attempts/results still flow through the shared multigame tables so
the aggregates match the other games. The Midi launched in 2026 and has a dense,
gapless daily history, so — unlike the Crossword — it needs no nearest-date
snapping.
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from ..db import PROJECT_ROOT, get_database_path


SCHEMA = """
CREATE TABLE IF NOT EXISTS daily_midi (
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
CREATE INDEX IF NOT EXISTS idx_daily_midi_fetched_at ON daily_midi (fetched_at);
"""


def get_midi_database_path() -> Path:
    configured_path = os.environ.get("MIDI_DATABASE_PATH")
    if configured_path:
        path = Path(configured_path)
        if not path.is_absolute():
            path = PROJECT_ROOT / path
        return path

    # Keep this database beside the main one so a test override of DATABASE_PATH
    # (e.g. a temp file) also relocates it away from real data.
    return get_database_path().parent / "midi.sqlite"


def connect_midi() -> sqlite3.Connection:
    database_path = get_midi_database_path()
    database_path.parent.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    # Schema self-managed here (rather than in the shared init_db) so the separate
    # database stays fully decoupled from wordbee.sqlite.
    connection.executescript(SCHEMA)
    return connection
