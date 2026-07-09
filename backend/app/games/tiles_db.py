"""Dedicated database for Tiles art palettes.

Unlike the word games, Tiles has no per-day puzzle payload to cache: a day's
board is *generated* deterministically from the date (see ``tiles.py``), so the
only durable data is the art itself. Each NYT palette (e.g. "brighton") ships a
block of SVG ``<symbol>`` definitions plus three theme colours, and there are a
small, fixed number of them (~15). They are bulky (tens of KB each) and wholly
game-specific, so they live in their own SQLite file — mirroring how Letter
Boxed and Spelling Bee keep their bulky raw data out of the shared
``wordbee.sqlite``. Family stats/attempts/results still flow through the shared
multigame tables, so the aggregates match the other games.
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from ..db import PROJECT_ROOT, get_database_path


SCHEMA = """
CREATE TABLE IF NOT EXISTS tiles_palettes (
  filename TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_by TEXT,
  bg_color TEXT NOT NULL,
  font_color TEXT NOT NULL,
  selection_color TEXT NOT NULL,
  z_layer_json TEXT NOT NULL,
  layers_json TEXT NOT NULL,
  svg TEXT NOT NULL,
  icon_svg TEXT,
  status TEXT NOT NULL,
  source_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
"""


def get_tiles_database_path() -> Path:
    configured_path = os.environ.get("TILES_DATABASE_PATH")
    if configured_path:
        path = Path(configured_path)
        if not path.is_absolute():
            path = PROJECT_ROOT / path
        return path

    # Keep the Tiles database beside the main one so a test override of
    # DATABASE_PATH (e.g. a temp file) also relocates this away from real data.
    return get_database_path().parent / "tiles.sqlite"


def connect_tiles() -> sqlite3.Connection:
    database_path = get_tiles_database_path()
    database_path.parent.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    # The schema is self-managed here (rather than in the shared init_db) so the
    # separate database stays fully decoupled from wordbee.sqlite.
    connection.executescript(SCHEMA)
    return connection
