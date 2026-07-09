from __future__ import annotations

import os
import sqlite3
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATABASE_PATH = PROJECT_ROOT / "data" / "wordbee.sqlite"
SCHEMA_PATH = PROJECT_ROOT / "backend" / "schema.sql"


def get_database_path() -> Path:
    configured_path = os.environ.get("DATABASE_PATH")

    if configured_path:
        path = Path(configured_path)
        if not path.is_absolute():
            path = PROJECT_ROOT / path
        return path

    return DEFAULT_DATABASE_PATH


def connect() -> sqlite3.Connection:
    database_path = get_database_path()
    database_path.parent.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    return connection


def connect_game(game_key: str) -> sqlite3.Connection:
    """Connect to a game's dedicated SQLite database, initializing its schema if needed."""
    if game_key == "letterboxed":
        from .games.letterboxed_db import connect_letterboxed
        return connect_letterboxed()

    if game_key == "spellingbee":
        from .games.spellingbee_db import connect_spellingbee
        return connect_spellingbee()

    if game_key == "tiles":
        from .games.tiles_db import connect_tiles
        return connect_tiles()

    if game_key == "crossword":
        from .games.crossword_db import connect_crossword
        return connect_crossword()

    if game_key == "mini":
        from .games.mini_db import connect_mini
        return connect_mini()

    if game_key == "midi":
        from .games.midi_db import connect_midi
        return connect_midi()

    db_filename = f"{game_key}.sqlite"
    database_path = get_database_path().parent / db_filename
    database_path.parent.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row

    # Initialize the schema for this game specifically
    schemas = {
        "wordle": """
            CREATE TABLE IF NOT EXISTS daily_answers (
              puzzle_date TEXT PRIMARY KEY,
              answer TEXT NOT NULL,
              answer_length INTEGER NOT NULL,
              confidence INTEGER NOT NULL,
              status TEXT NOT NULL,
              source_count INTEGER NOT NULL,
              sources_json TEXT NOT NULL,
              fetched_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_daily_answers_fetched_at ON daily_answers (fetched_at);
        """,
        "connections": """
            CREATE TABLE IF NOT EXISTS daily_connections (
              puzzle_date TEXT PRIMARY KEY,
              external_id TEXT,
              editor TEXT,
              cards_json TEXT NOT NULL,
              groups_json TEXT NOT NULL,
              status TEXT NOT NULL,
              source_json TEXT NOT NULL,
              fetched_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_daily_connections_fetched_at ON daily_connections (fetched_at);
        """,
        "strands": """
            CREATE TABLE IF NOT EXISTS daily_strands (
              puzzle_date TEXT PRIMARY KEY,
              external_id TEXT,
              editor TEXT,
              constructors TEXT,
              clue TEXT NOT NULL,
              board_json TEXT NOT NULL,
              theme_words_json TEXT NOT NULL,
              spangram TEXT NOT NULL,
              theme_paths_json TEXT NOT NULL,
              spangram_path_json TEXT NOT NULL,
              allowed_words_json TEXT NOT NULL,
              status TEXT NOT NULL,
              source_json TEXT NOT NULL,
              fetched_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_daily_strands_fetched_at ON daily_strands (fetched_at);
        """,
        "sudoku": """
            CREATE TABLE IF NOT EXISTS daily_sudoku (
              puzzle_date TEXT NOT NULL,
              difficulty TEXT NOT NULL,
              external_id TEXT,
              display_date TEXT,
              puzzle_json TEXT NOT NULL,
              solution_json TEXT NOT NULL,
              status TEXT NOT NULL,
              source_json TEXT NOT NULL,
              fetched_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (puzzle_date, difficulty)
            );
            CREATE INDEX IF NOT EXISTS idx_daily_sudoku_fetched_at ON daily_sudoku (fetched_at);
        """,
    }

    schema = schemas.get(game_key)
    if schema:
        connection.executescript(schema)

    return connection


def init_db() -> None:
    with connect() as connection:
        connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        migrate_db(connection)


def migrate_db(connection: sqlite3.Connection) -> None:
    user_columns = {
        row["name"]
        for row in connection.execute("PRAGMA table_info(friends_family_users)").fetchall()
    }
    if "avatar_json" not in user_columns:
        connection.execute("ALTER TABLE friends_family_users ADD COLUMN avatar_json TEXT")

    # Distinguish live daily completions from retroactive (archive) plays so stats
    # can count only daily plays while the calendar still records everything.
    for table in ("friends_family_daily_results", "friends_family_game_results"):
        columns = {
            row["name"]
            for row in connection.execute(f"PRAGMA table_info({table})").fetchall()
        }
        if columns and "play_type" not in columns:
            connection.execute(
                f"ALTER TABLE {table} ADD COLUMN play_type TEXT NOT NULL DEFAULT 'daily'"
            )
            # Best-effort backfill: a play finished on a different calendar day than
            # the puzzle date was almost certainly retroactive.
            connection.execute(
                f"""
                UPDATE {table}
                SET play_type = 'retro'
                WHERE substr(completed_at, 1, 10) <> puzzle_date
                """
            )
