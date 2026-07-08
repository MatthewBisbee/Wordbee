"""Central registry of playable games.

Adding a new puzzle game (including a custom one) is intentionally small: create a
module under ``app/games/`` that exposes a ``get_*_puzzle``/``public_*_puzzle``/
``warm_*`` trio, then add a single :class:`GameSpec` entry to ``GAMES`` below. The
generic daily/date-resolution/warmup/results/calendar plumbing then works for it
automatically. Game-specific play mechanics (guess, reveal, check, hint) stay in
the game's own module and are wired up as explicit routes.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Callable

from ..daily_answer import get_puzzle_date
from .connections import (
    get_connections_puzzle,
    public_connections_puzzle,
    warm_connections_puzzle,
)
from .strands import get_strands_puzzle, public_strands_puzzle, warm_strands_puzzle
from .sudoku import get_sudoku_puzzle, public_sudoku_puzzle, warm_sudoku_puzzles


@dataclass(frozen=True)
class GameSpec:
    key: str
    first_date: date
    build_public_puzzle: Callable[[date, dict[str, Any], bool], dict[str, Any]]
    warm: Callable[[date], dict[str, Any]]


def _connections_public(puzzle_date: date, _params: dict[str, Any], force_refresh: bool) -> dict[str, Any]:
    return public_connections_puzzle(get_connections_puzzle(puzzle_date, force_refresh=force_refresh))


def _strands_public(puzzle_date: date, _params: dict[str, Any], force_refresh: bool) -> dict[str, Any]:
    return public_strands_puzzle(get_strands_puzzle(puzzle_date, force_refresh=force_refresh))


def _sudoku_public(puzzle_date: date, params: dict[str, Any], force_refresh: bool) -> dict[str, Any]:
    difficulty = str(params.get("difficulty") or "medium")
    return public_sudoku_puzzle(get_sudoku_puzzle(puzzle_date, difficulty, force_refresh=force_refresh))


# Connections/Strands reach back to their NYT launch; Sudoku has no dated NYT
# endpoint so its floor matches the app's shared archive era (see sudoku.py).
GAMES: dict[str, GameSpec] = {
    "connections": GameSpec("connections", date(2023, 6, 12), _connections_public, warm_connections_puzzle),
    "strands": GameSpec("strands", date(2024, 3, 4), _strands_public, warm_strands_puzzle),
    "sudoku": GameSpec("sudoku", date(2021, 6, 19), _sudoku_public, warm_sudoku_puzzles),
}

GAME_KEYS: set[str] = set(GAMES)
GAME_FIRST_DATES: dict[str, date] = {key: spec.first_date for key, spec in GAMES.items()}


def get_game_first_date(game_key: str) -> date:
    spec = GAMES.get(game_key)
    if spec is None:
        raise ValueError("Invalid game")
    return spec.first_date


def resolve_multigame_date(
    game_key: str,
    puzzle_date: date,
    *,
    today: date | None = None,
) -> tuple[date, dict[str, Any]]:
    """Clamp a requested date into this game's playable window (Wordle-style)."""
    first_date = get_game_first_date(game_key)
    newest_date = today or get_puzzle_date()
    resolved_date = min(max(puzzle_date, first_date), newest_date)

    clamp_info: dict[str, Any] = {}
    if puzzle_date < first_date:
        clamp_info["clampedToOldest"] = True
        clamp_info["oldestDate"] = first_date.isoformat()
    if puzzle_date > newest_date:
        clamp_info["clampedToNewest"] = True
        clamp_info["newestDate"] = newest_date.isoformat()

    return resolved_date, clamp_info


def get_public_puzzle(
    game_key: str,
    puzzle_date: date,
    params: dict[str, Any] | None = None,
    *,
    force_refresh: bool = False,
) -> dict[str, Any]:
    spec = GAMES.get(game_key)
    if spec is None:
        raise ValueError("Invalid game")
    return spec.build_public_puzzle(puzzle_date, params or {}, force_refresh)


def warm_all_games(puzzle_date: date | None = None) -> dict[str, Any]:
    """Fetch today's puzzles for every registered game without creating fallbacks."""
    target_date = puzzle_date or get_puzzle_date()
    results: dict[str, Any] = {key: spec.warm(target_date) for key, spec in GAMES.items()}
    results["date"] = target_date.isoformat()
    results["confirmed"] = all(
        result.get("confirmed") is True
        for key, result in results.items()
        if key not in {"date", "confirmed"}
    )
    return results
