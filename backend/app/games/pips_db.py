"""Dedicated database for Pips.

A day's Pips is three separate puzzles (easy/medium/hard), each an irregular
board of cells grouped into constraint regions, a bag of dominoes, and the
constructor's solution. Like Sudoku it is keyed by ``(puzzle_date, difficulty)``;
like Crossword/Tiles it keeps its bulky, wholly game-specific payloads in their
own SQLite file so the shared ``wordbee.sqlite`` stays small. Family
stats/attempts/results still flow through the shared multigame tables so the
aggregates match the other games.
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from ..db import PROJECT_ROOT, get_database_path


SCHEMA = """
CREATE TABLE IF NOT EXISTS daily_pips (
  puzzle_date TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  external_id TEXT,
  backend_id TEXT,
  editor TEXT,
  constructors TEXT,
  rows INTEGER NOT NULL,
  cols INTEGER NOT NULL,
  dominoes_json TEXT NOT NULL,
  regions_json TEXT NOT NULL,
  solution_json TEXT NOT NULL,
  status TEXT NOT NULL,
  source_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (puzzle_date, difficulty)
);
CREATE INDEX IF NOT EXISTS idx_daily_pips_fetched_at ON daily_pips (fetched_at);
"""


def get_pips_database_path() -> Path:
    configured_path = os.environ.get("PIPS_DATABASE_PATH")
    if configured_path:
        path = Path(configured_path)
        if not path.is_absolute():
            path = PROJECT_ROOT / path
        return path

    # Keep the Pips database beside the main one so a test override of
    # DATABASE_PATH (e.g. a temp file) also relocates this away from real data.
    return get_database_path().parent / "pips.sqlite"


def connect_pips() -> sqlite3.Connection:
    database_path = get_pips_database_path()
    database_path.parent.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    # The schema is self-managed here (rather than in the shared init_db) so the
    # separate database stays fully decoupled from wordbee.sqlite.
    connection.executescript(SCHEMA)
    return connection
