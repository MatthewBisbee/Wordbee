from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from .db import connect


DEFAULT_DISTRIBUTION = {str(index): 0 for index in range(1, 7)}
VALID_STATES = {"correct", "present", "absent"}


def save_completed_game(
    *,
    game_id: str,
    puzzle_date: str,
    mode: str,
    outcome: str,
    guesses_used: int,
    hard_mode: bool,
    board: list[list[str]],
) -> dict[str, Any]:
    if not game_id:
        raise ValueError("Missing game id")

    if mode != "daily":
        raise ValueError("Only daily results are tracked right now")

    if outcome not in {"won", "lost"}:
        raise ValueError("Invalid outcome")

    if guesses_used < 1 or guesses_used > 6:
        raise ValueError("Invalid guess count")

    normalized_board = normalize_board(board)
    now = datetime.now().astimezone().isoformat()

    with connect() as connection:
        cursor = connection.execute(
            """
            INSERT OR IGNORE INTO completed_games (
              id, puzzle_date, mode, outcome, guesses_used,
              hard_mode, board_json, completed_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                game_id,
                puzzle_date,
                mode,
                outcome,
                guesses_used,
                int(hard_mode),
                json.dumps(normalized_board, separators=(",", ":")),
                now,
            ),
        )
        created = cursor.rowcount == 1

    return {
        "board": normalized_board,
        "created": created,
        "stats": get_stats(mode=mode),
    }


def get_stats(mode: str = "daily") -> dict[str, Any]:
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT puzzle_date, outcome, guesses_used, completed_at
            FROM completed_games
            WHERE mode = ?
            ORDER BY completed_at ASC
            """,
            (mode,),
        ).fetchall()

    played = len(rows)
    wins = [row for row in rows if row["outcome"] == "won"]
    distribution = dict(DEFAULT_DISTRIBUTION)

    for row in wins:
        distribution[str(row["guesses_used"])] += 1

    current_streak = 0
    for row in reversed(rows):
        if row["outcome"] != "won":
            break
        current_streak += 1

    max_streak = 0
    running_streak = 0
    for row in rows:
        if row["outcome"] == "won":
            running_streak += 1
        else:
            running_streak = 0
        max_streak = max(max_streak, running_streak)

    return {
        "played": played,
        "winPercentage": round((len(wins) / played) * 100) if played else 0,
        "currentStreak": current_streak,
        "maxStreak": max_streak,
        "guessDistribution": distribution,
    }


def normalize_board(board: list[list[str]]) -> list[list[str]]:
    normalized_board: list[list[str]] = []

    if not isinstance(board, list):
        raise ValueError("Invalid board")

    for row in board:
        if not isinstance(row, list) or len(row) != 5:
            raise ValueError("Invalid board")

        normalized_row = []
        for state in row:
            if state not in VALID_STATES:
                raise ValueError("Invalid board")
            normalized_row.append(state)

        normalized_board.append(normalized_row)

    if not normalized_board or len(normalized_board) > 6:
        raise ValueError("Invalid board")

    return normalized_board
