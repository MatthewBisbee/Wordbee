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
from .crossword import (
    CROSSWORD_FIRST_DATE,
    get_crossword_puzzle,
    public_crossword_puzzle,
    warm_crossword_puzzle,
)
from .letterboxed import (
    get_letterboxed_puzzle,
    public_letterboxed_puzzle,
    warm_letterboxed_puzzle,
)
from .midi import MIDI_FIRST_DATE, get_midi_puzzle, public_midi_puzzle, warm_midi_puzzle
from .mini import MINI_FIRST_DATE, get_mini_puzzle, public_mini_puzzle, warm_mini_puzzle
from .spellingbee import (
    get_spellingbee_puzzle,
    public_spellingbee_puzzle,
    warm_spellingbee_puzzle,
)
from .strands import get_strands_puzzle, public_strands_puzzle, warm_strands_puzzle
from .sudoku import get_sudoku_puzzle, public_sudoku_puzzle, warm_sudoku_puzzles
from .tiles import get_tiles_puzzle, public_tiles_puzzle, warm_tiles_puzzle


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


def _letterboxed_public(puzzle_date: date, _params: dict[str, Any], force_refresh: bool) -> dict[str, Any]:
    return public_letterboxed_puzzle(get_letterboxed_puzzle(puzzle_date, force_refresh=force_refresh))


def _spellingbee_public(puzzle_date: date, _params: dict[str, Any], force_refresh: bool) -> dict[str, Any]:
    return public_spellingbee_puzzle(get_spellingbee_puzzle(puzzle_date, force_refresh=force_refresh))


def _tiles_public(puzzle_date: date, _params: dict[str, Any], force_refresh: bool) -> dict[str, Any]:
    return public_tiles_puzzle(get_tiles_puzzle(puzzle_date, force_refresh=force_refresh))


def _crossword_public(puzzle_date: date, _params: dict[str, Any], force_refresh: bool) -> dict[str, Any]:
    return public_crossword_puzzle(get_crossword_puzzle(puzzle_date, force_refresh=force_refresh))


def _mini_public(puzzle_date: date, _params: dict[str, Any], force_refresh: bool) -> dict[str, Any]:
    return public_mini_puzzle(get_mini_puzzle(puzzle_date, force_refresh=force_refresh))


def _midi_public(puzzle_date: date, _params: dict[str, Any], force_refresh: bool) -> dict[str, Any]:
    return public_midi_puzzle(get_midi_puzzle(puzzle_date, force_refresh=force_refresh))


# Connections/Strands/Letter Boxed reach back to their NYT launch; Sudoku has no
# dated NYT endpoint so its floor matches the app's shared archive era. Letter
# Boxed (like Sudoku) has no dated endpoint either, so pre-launch/uncaptured days
# resolve to the Internet Archive or a bundled fallback (see letterboxed.py).
GAMES: dict[str, GameSpec] = {
    "connections": GameSpec("connections", date(2023, 6, 12), _connections_public, warm_connections_puzzle),
    "strands": GameSpec("strands", date(2024, 3, 4), _strands_public, warm_strands_puzzle),
    "sudoku": GameSpec("sudoku", date(2021, 6, 19), _sudoku_public, warm_sudoku_puzzles),
    "letterboxed": GameSpec("letterboxed", date(2019, 2, 1), _letterboxed_public, warm_letterboxed_puzzle),
    "spellingbee": GameSpec("spellingbee", date(2018, 5, 9), _spellingbee_public, warm_spellingbee_puzzle),
    "tiles": GameSpec("tiles", date(2023, 4, 24), _tiles_public, warm_tiles_puzzle),
    "crossword": GameSpec("crossword", CROSSWORD_FIRST_DATE, _crossword_public, warm_crossword_puzzle),
    "mini": GameSpec("mini", MINI_FIRST_DATE, _mini_public, warm_mini_puzzle),
    "midi": GameSpec("midi", MIDI_FIRST_DATE, _midi_public, warm_midi_puzzle),
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
