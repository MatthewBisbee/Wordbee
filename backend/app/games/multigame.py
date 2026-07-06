from __future__ import annotations

import json
import random
import re
from datetime import date, datetime
from html import unescape
from typing import Any

import requests

from ..auth import decode_avatar_json
from ..daily_answer import get_puzzle_date
from ..db import connect


CONNECTIONS_GROUPS = 4
CONNECTIONS_CARDS_PER_GROUP = 4
CONNECTIONS_MISTAKES_ALLOWED = 4
GAME_KEYS = {"connections", "strands", "sudoku"}
SUDOKU_DIFFICULTIES = {"easy", "medium", "hard"}
SOURCE_TIMEOUT_SECONDS = 8
PUBLISHER_BASE_URL = "https://www.nytimes.com/svc"
SUDOKU_PAGE_URL = "https://www.nytimes.com/puzzles/sudoku"
USER_AGENT = "Wordbee/0.1 (+https://github.com/MatthewBisbee/Wordbee)"
MAX_GAME_HISTORY_RESULTS = 40

CONNECTIONS_FALLBACK_GROUPS = (
    ("CARD SUITS", ("HEARTS", "CLUBS", "DIAMONDS", "SPADES")),
    ("PLANETS", ("EARTH", "MARS", "VENUS", "SATURN")),
    ("KITCHEN TOOLS", ("WHISK", "LADLE", "SPATULA", "TONGS")),
    ("TREE TYPES", ("CEDAR", "MAPLE", "OAK", "PINE")),
    ("MUSIC GENRES", ("BLUES", "JAZZ", "POP", "ROCK")),
    ("BOARD GAME PIECES", ("CARD", "DIE", "MEEPLE", "TOKEN")),
    ("CAN BE GREEN", ("LIGHT", "ONION", "ROOM", "TEA")),
    ("KEYBOARD KEYS", ("COMMAND", "OPTION", "SHIFT", "SPACE")),
)

STRANDS_FALLBACK = {
    "clue": "Morning spread",
    "themeWords": ["BAGEL", "CEREAL", "COFFEE", "OMELET", "PANCAKE", "TOAST"],
    "spangram": "BREAKFAST",
    "startingBoard": [
        "BREAKF",
        "TOATSA",
        "BTSCER",
        "AGELAE",
        "COFFLG",
        "OMEEPA",
        "SELETN",
        "IREKAC",
    ],
    "themeCoords": {
        "BAGEL": [[2, 0], [3, 0], [3, 1], [3, 2], [3, 3]],
        "CEREAL": [[2, 3], [2, 4], [2, 5], [3, 5], [3, 4], [4, 4]],
        "COFFEE": [[4, 0], [4, 1], [4, 2], [4, 3], [5, 3], [5, 2]],
        "OMELET": [[5, 0], [5, 1], [6, 1], [6, 2], [6, 3], [6, 4]],
        "PANCAKE": [[5, 4], [5, 5], [6, 5], [7, 5], [7, 4], [7, 3], [7, 2]],
        "TOAST": [[1, 0], [1, 1], [1, 2], [2, 2], [2, 1]],
    },
    "spangramCoords": [
        [0, 0],
        [0, 1],
        [0, 2],
        [0, 3],
        [0, 4],
        [0, 5],
        [1, 5],
        [1, 4],
        [1, 3],
    ],
    "solutions": ["BAGEL", "CEREAL", "COFFEE", "OMELET", "PANCAKE", "TOAST", "BREAKFAST"],
}


def get_connections_puzzle(
    puzzle_date: date,
    *,
    force_refresh: bool = False,
) -> dict[str, Any]:
    if not force_refresh:
        cached = get_cached_connections(puzzle_date)
        if cached is not None:
            return cached

    fetched = fetch_connections_source(puzzle_date)
    if fetched["ok"]:
        return save_connections_puzzle(
            puzzle_date=puzzle_date,
            external_id=str(fetched["payload"].get("id") or ""),
            editor=normalize_text(fetched["payload"].get("editor"), max_length=80),
            cards=fetched["cards"],
            groups=fetched["groups"],
            status="confirmed",
            source=fetched["source"],
        )

    fallback = create_connections_fallback(puzzle_date)
    return save_connections_puzzle(
        puzzle_date=puzzle_date,
        external_id="",
        editor="Wordbee",
        cards=fallback["cards"],
        groups=fallback["groups"],
        status="generated",
        source=fetched["source"],
    )


def get_strands_puzzle(puzzle_date: date, *, force_refresh: bool = False) -> dict[str, Any]:
    if not force_refresh:
        cached = get_cached_strands(puzzle_date)
        if cached is not None:
            return cached

    fetched = fetch_strands_source(puzzle_date)
    if fetched["ok"]:
        payload = fetched["payload"]
        return save_strands_puzzle(
            puzzle_date=puzzle_date,
            external_id=str(payload.get("id") or ""),
            editor=normalize_text(payload.get("editor"), max_length=80),
            constructors=normalize_text(payload.get("constructors"), max_length=120),
            clue=normalize_text(payload.get("clue"), max_length=120) or "Today's theme",
            board=fetched["board"],
            theme_words=fetched["theme_words"],
            spangram=fetched["spangram"],
            theme_paths=fetched["theme_paths"],
            spangram_path=fetched["spangram_path"],
            allowed_words=fetched["allowed_words"],
            status="confirmed",
            source=fetched["source"],
        )

    fallback = create_strands_fallback(puzzle_date)
    return save_strands_puzzle(
        puzzle_date=puzzle_date,
        external_id="",
        editor="Wordbee",
        constructors="Wordbee",
        clue=fallback["clue"],
        board=fallback["board"],
        theme_words=fallback["theme_words"],
        spangram=fallback["spangram"],
        theme_paths=fallback["theme_paths"],
        spangram_path=fallback["spangram_path"],
        allowed_words=fallback["allowed_words"],
        status="generated",
        source=fetched["source"],
    )


def get_sudoku_puzzle(
    puzzle_date: date,
    difficulty: str,
    *,
    force_refresh: bool = False,
) -> dict[str, Any]:
    normalized_difficulty = normalize_sudoku_difficulty(difficulty)

    if not force_refresh:
        cached = get_cached_sudoku(puzzle_date, normalized_difficulty)
        if cached is not None:
            return cached

    fetched = fetch_sudoku_source(puzzle_date)
    if fetched["ok"]:
        saved_puzzle = None
        for difficulty_key, puzzle in fetched["puzzles"].items():
            saved = save_sudoku_puzzle(
                puzzle_date=puzzle_date,
                difficulty=difficulty_key,
                external_id=str(puzzle.get("puzzle_id") or ""),
                display_date=fetched["display_date"],
                puzzle=puzzle["puzzle_data"]["puzzle"],
                solution=puzzle["puzzle_data"]["solution"],
                status="confirmed",
                source=fetched["source"],
            )
            if difficulty_key == normalized_difficulty:
                saved_puzzle = saved

        if saved_puzzle is not None:
            return saved_puzzle

    fallback = create_sudoku_fallback(puzzle_date, normalized_difficulty)
    return save_sudoku_puzzle(
        puzzle_date=puzzle_date,
        difficulty=normalized_difficulty,
        external_id="",
        display_date=puzzle_date.strftime("%B %-d, %Y"),
        puzzle=fallback["puzzle"],
        solution=fallback["solution"],
        status="generated",
        source=fetched["source"],
    )


def check_connections_guess(puzzle_date: date, raw_cards: object) -> dict[str, Any]:
    puzzle = get_connections_puzzle(puzzle_date)
    cards = normalize_connections_guess(raw_cards)
    if len(cards) != CONNECTIONS_CARDS_PER_GROUP:
        raise ValueError("Choose four cards")

    guessed = set(cards)
    groups = puzzle["groups"]
    best_overlap = 0
    for group in groups:
        group_cards = set(group["cards"])
        overlap = len(guessed.intersection(group_cards))
        best_overlap = max(best_overlap, overlap)
        if guessed == group_cards:
            return {
                "correct": True,
                "oneAway": False,
                "group": public_connections_group(group),
            }

    return {
        "correct": False,
        "oneAway": best_overlap == CONNECTIONS_CARDS_PER_GROUP - 1,
    }


def check_strands_guess(puzzle_date: date, raw_path: object) -> dict[str, Any]:
    puzzle = get_strands_puzzle(puzzle_date)
    path = normalize_strands_path(raw_path, puzzle["board"])
    word = get_strands_path_word(puzzle["board"], path)
    reverse_word = word[::-1]
    theme_words = {word.upper(): word for word in puzzle["themeWords"]}

    if word == puzzle["spangram"] or reverse_word == puzzle["spangram"]:
        return {
            "valid": True,
            "kind": "spangram",
            "word": puzzle["spangram"],
            "path": puzzle["spangramPath"],
        }

    if word in theme_words or reverse_word in theme_words:
        matched_word = word if word in theme_words else reverse_word
        return {
            "valid": True,
            "kind": "theme",
            "word": matched_word,
            "path": puzzle["themePaths"][matched_word],
        }

    allowed_words = set(puzzle["allowedWords"])
    matched_bonus = word if word in allowed_words else reverse_word
    if len(matched_bonus) >= 4 and matched_bonus in allowed_words:
        return {
            "valid": True,
            "kind": "bonus",
            "word": matched_bonus,
            "path": path,
        }

    return {"valid": False, "kind": "invalid", "word": word}


def validate_sudoku_grid(puzzle_date: date, difficulty: str, raw_grid: object) -> dict[str, Any]:
    puzzle = get_sudoku_puzzle(puzzle_date, difficulty)
    grid = normalize_sudoku_grid(raw_grid)
    solution = puzzle["solution"]
    mistakes = [
        index
        for index, value in enumerate(grid)
        if value is not None and value != solution[index]
    ]
    is_complete = all(value is not None for value in grid)
    is_solved = is_complete and not mistakes

    return {
        "complete": is_complete,
        "mistakes": mistakes,
        "solved": is_solved,
    }


def save_multigame_result(
    *,
    identity: dict[str, str] | None,
    game_key: str,
    puzzle_date: str,
    puzzle_variant: str,
    outcome: str,
    elapsed_seconds: int | None,
    score: dict[str, Any],
) -> dict[str, Any]:
    if game_key not in GAME_KEYS:
        raise ValueError("Invalid game")
    if outcome not in {"won", "lost"}:
        raise ValueError("Invalid outcome")
    if not puzzle_date:
        raise ValueError("Missing puzzle date")

    if identity is None:
        return {"created": False, "result": None}

    user_id = identity.get("userId")
    if not user_id:
        raise ValueError("Friends and family sign-in required")

    result_id = f"{user_id}:{game_key}:{puzzle_date}:{puzzle_variant or 'daily'}"
    now = datetime.now().astimezone().isoformat()
    normalized_score = json.dumps(score, separators=(",", ":"), sort_keys=True)

    with connect() as connection:
        cursor = connection.execute(
            """
            INSERT OR IGNORE INTO friends_family_game_results (
              id, user_id, game_key, puzzle_date, puzzle_variant, outcome,
              elapsed_seconds, score_json, completed_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                result_id,
                user_id,
                game_key,
                puzzle_date,
                puzzle_variant or "daily",
                outcome,
                elapsed_seconds,
                normalized_score,
                now,
            ),
        )
        created = cursor.rowcount == 1

    return {
        "created": created,
        "result": get_multigame_result_for_user(
            user_id=user_id,
            game_key=game_key,
            puzzle_date=puzzle_date,
            puzzle_variant=puzzle_variant or "daily",
        ),
    }


def get_multigame_result_for_user(
    *,
    user_id: str,
    game_key: str,
    puzzle_date: str,
    puzzle_variant: str,
) -> dict[str, Any] | None:
    with connect() as connection:
        row = connection.execute(
            """
            SELECT results.*, users.display_name, users.avatar_json
            FROM friends_family_game_results AS results
            JOIN friends_family_users AS users ON users.id = results.user_id
            WHERE results.user_id = ?
              AND results.game_key = ?
              AND results.puzzle_date = ?
              AND results.puzzle_variant = ?
            """,
            (user_id, game_key, puzzle_date, puzzle_variant),
        ).fetchone()

    return serialize_multigame_result(row) if row else None


def get_multigame_dashboard(*, requesting_user_id: str) -> dict[str, Any]:
    with connect() as connection:
        requesting_user = connection.execute(
            """
            SELECT code_id
            FROM friends_family_users
            WHERE id = ?
            """,
            (requesting_user_id,),
        ).fetchone()
        if requesting_user is None:
            return {
                "currentUserId": requesting_user_id,
                "games": empty_multigame_dashboard(),
            }

        user_rows = connection.execute(
            """
            SELECT id, display_name, first_name, last_initial, avatar_json
            FROM friends_family_users
            WHERE code_id = ?
            ORDER BY first_name COLLATE NOCASE ASC, last_initial COLLATE NOCASE ASC
            """,
            (requesting_user["code_id"],),
        ).fetchall()
        result_rows = connection.execute(
            """
            SELECT results.*, users.display_name, users.avatar_json
            FROM friends_family_game_results AS results
            JOIN friends_family_users AS users ON users.id = results.user_id
            WHERE users.code_id = ?
            ORDER BY results.puzzle_date DESC, results.completed_at DESC
            """,
            (requesting_user["code_id"],),
        ).fetchall()

    users = [serialize_multigame_user(row) for row in user_rows]
    results = [serialize_multigame_result(row) for row in result_rows]
    dashboard = empty_multigame_dashboard()

    for game_key in GAME_KEYS:
        game_results = [result for result in results if result["gameKey"] == game_key]
        dashboard[game_key] = {
            "groupStats": calculate_multigame_stats(game_results),
            "users": [
                {
                    **user,
                    "stats": calculate_multigame_stats(
                        [result for result in game_results if result["userId"] == user["id"]]
                    ),
                    "history": [
                        result
                        for result in game_results
                        if result["userId"] == user["id"]
                    ][:MAX_GAME_HISTORY_RESULTS],
                }
                for user in users
            ],
        }

    return {
        "currentUserId": requesting_user_id,
        "games": dashboard,
    }


def public_connections_puzzle(puzzle: dict[str, Any]) -> dict[str, Any]:
    return {
        "gameKey": "connections",
        "date": puzzle["date"],
        "editor": puzzle["editor"],
        "status": puzzle["status"],
        "cards": puzzle["cards"],
        "mistakesAllowed": CONNECTIONS_MISTAKES_ALLOWED,
    }


def public_connections_solution(puzzle: dict[str, Any]) -> list[dict[str, Any]]:
    return [public_connections_group(group) for group in puzzle["groups"]]


def public_strands_puzzle(puzzle: dict[str, Any]) -> dict[str, Any]:
    return {
        "gameKey": "strands",
        "date": puzzle["date"],
        "clue": puzzle["clue"],
        "constructors": puzzle["constructors"],
        "editor": puzzle["editor"],
        "status": puzzle["status"],
        "board": puzzle["board"],
        "themeWordCount": len(puzzle["themeWords"]),
        "spangramLength": len(puzzle["spangram"]),
    }


def public_strands_solution(puzzle: dict[str, Any]) -> dict[str, Any]:
    return {
        "themeWords": puzzle["themeWords"],
        "spangram": puzzle["spangram"],
        "themePaths": puzzle["themePaths"],
        "spangramPath": puzzle["spangramPath"],
    }


def public_sudoku_puzzle(puzzle: dict[str, Any]) -> dict[str, Any]:
    return {
        "gameKey": "sudoku",
        "date": puzzle["date"],
        "difficulty": puzzle["difficulty"],
        "displayDate": puzzle["displayDate"],
        "status": puzzle["status"],
        "puzzle": puzzle["puzzle"],
    }


def get_cached_connections(puzzle_date: date) -> dict[str, Any] | None:
    with connect() as connection:
        row = connection.execute(
            """
            SELECT puzzle_date, external_id, editor, cards_json, groups_json,
                   status, source_json, fetched_at, updated_at
            FROM daily_connections
            WHERE puzzle_date = ?
            """,
            (puzzle_date.isoformat(),),
        ).fetchone()

    return serialize_connections(row) if row else None


def save_connections_puzzle(
    *,
    puzzle_date: date,
    external_id: str,
    editor: str,
    cards: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    status: str,
    source: dict[str, Any],
) -> dict[str, Any]:
    now = datetime.now().astimezone().isoformat()
    with connect() as connection:
        connection.execute(
            """
            INSERT INTO daily_connections (
              puzzle_date, external_id, editor, cards_json, groups_json,
              status, source_json, fetched_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(puzzle_date) DO UPDATE SET
              external_id = excluded.external_id,
              editor = excluded.editor,
              cards_json = excluded.cards_json,
              groups_json = excluded.groups_json,
              status = excluded.status,
              source_json = excluded.source_json,
              fetched_at = excluded.fetched_at,
              updated_at = excluded.updated_at
            """,
            (
                puzzle_date.isoformat(),
                external_id,
                editor,
                json.dumps(cards, separators=(",", ":")),
                json.dumps(groups, separators=(",", ":")),
                status,
                json.dumps(source, separators=(",", ":")),
                now,
                now,
            ),
        )

    cached = get_cached_connections(puzzle_date)
    if cached is None:
        raise RuntimeError("Unable to cache Connections puzzle")
    return cached


def get_cached_strands(puzzle_date: date) -> dict[str, Any] | None:
    with connect() as connection:
        row = connection.execute(
            """
            SELECT puzzle_date, external_id, editor, constructors, clue,
                   board_json, theme_words_json, spangram, theme_paths_json,
                   spangram_path_json, allowed_words_json, status, source_json,
                   fetched_at, updated_at
            FROM daily_strands
            WHERE puzzle_date = ?
            """,
            (puzzle_date.isoformat(),),
        ).fetchone()

    return serialize_strands(row) if row else None


def save_strands_puzzle(
    *,
    puzzle_date: date,
    external_id: str,
    editor: str,
    constructors: str,
    clue: str,
    board: list[str],
    theme_words: list[str],
    spangram: str,
    theme_paths: dict[str, list[list[int]]],
    spangram_path: list[list[int]],
    allowed_words: list[str],
    status: str,
    source: dict[str, Any],
) -> dict[str, Any]:
    now = datetime.now().astimezone().isoformat()
    with connect() as connection:
        connection.execute(
            """
            INSERT INTO daily_strands (
              puzzle_date, external_id, editor, constructors, clue, board_json,
              theme_words_json, spangram, theme_paths_json, spangram_path_json,
              allowed_words_json, status, source_json, fetched_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(puzzle_date) DO UPDATE SET
              external_id = excluded.external_id,
              editor = excluded.editor,
              constructors = excluded.constructors,
              clue = excluded.clue,
              board_json = excluded.board_json,
              theme_words_json = excluded.theme_words_json,
              spangram = excluded.spangram,
              theme_paths_json = excluded.theme_paths_json,
              spangram_path_json = excluded.spangram_path_json,
              allowed_words_json = excluded.allowed_words_json,
              status = excluded.status,
              source_json = excluded.source_json,
              fetched_at = excluded.fetched_at,
              updated_at = excluded.updated_at
            """,
            (
                puzzle_date.isoformat(),
                external_id,
                editor,
                constructors,
                clue,
                json.dumps(board, separators=(",", ":")),
                json.dumps(theme_words, separators=(",", ":")),
                spangram,
                json.dumps(theme_paths, separators=(",", ":")),
                json.dumps(spangram_path, separators=(",", ":")),
                json.dumps(allowed_words, separators=(",", ":")),
                status,
                json.dumps(source, separators=(",", ":")),
                now,
                now,
            ),
        )

    cached = get_cached_strands(puzzle_date)
    if cached is None:
        raise RuntimeError("Unable to cache Strands puzzle")
    return cached


def get_cached_sudoku(puzzle_date: date, difficulty: str) -> dict[str, Any] | None:
    with connect() as connection:
        row = connection.execute(
            """
            SELECT puzzle_date, difficulty, external_id, display_date,
                   puzzle_json, solution_json, status, source_json,
                   fetched_at, updated_at
            FROM daily_sudoku
            WHERE puzzle_date = ? AND difficulty = ?
            """,
            (puzzle_date.isoformat(), difficulty),
        ).fetchone()

    return serialize_sudoku(row) if row else None


def save_sudoku_puzzle(
    *,
    puzzle_date: date,
    difficulty: str,
    external_id: str,
    display_date: str,
    puzzle: list[int],
    solution: list[int],
    status: str,
    source: dict[str, Any],
) -> dict[str, Any]:
    normalized_puzzle = normalize_sudoku_numbers(puzzle, allow_zero=True)
    normalized_solution = normalize_sudoku_numbers(solution, allow_zero=False)
    now = datetime.now().astimezone().isoformat()
    with connect() as connection:
        connection.execute(
            """
            INSERT INTO daily_sudoku (
              puzzle_date, difficulty, external_id, display_date, puzzle_json,
              solution_json, status, source_json, fetched_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(puzzle_date, difficulty) DO UPDATE SET
              external_id = excluded.external_id,
              display_date = excluded.display_date,
              puzzle_json = excluded.puzzle_json,
              solution_json = excluded.solution_json,
              status = excluded.status,
              source_json = excluded.source_json,
              fetched_at = excluded.fetched_at,
              updated_at = excluded.updated_at
            """,
            (
                puzzle_date.isoformat(),
                difficulty,
                external_id,
                display_date,
                json.dumps(normalized_puzzle, separators=(",", ":")),
                json.dumps(normalized_solution, separators=(",", ":")),
                status,
                json.dumps(source, separators=(",", ":")),
                now,
                now,
            ),
        )

    cached = get_cached_sudoku(puzzle_date, difficulty)
    if cached is None:
        raise RuntimeError("Unable to cache Sudoku puzzle")
    return cached


def fetch_connections_source(puzzle_date: date) -> dict[str, Any]:
    url = f"{PUBLISHER_BASE_URL}/connections/v2/{puzzle_date.isoformat()}.json"
    source = {"id": "publisher", "url": url, "ok": False}

    try:
        payload = fetch_json(url)
        cards, groups = normalize_connections_payload(payload, puzzle_date)
    except Exception as exc:
        source["error"] = str(exc)
        return {"ok": False, "source": source}

    source["ok"] = True
    return {
        "ok": True,
        "cards": cards,
        "groups": groups,
        "payload": payload,
        "source": source,
    }


def fetch_strands_source(puzzle_date: date) -> dict[str, Any]:
    url = f"{PUBLISHER_BASE_URL}/strands/v2/{puzzle_date.isoformat()}.json"
    source = {"id": "publisher", "url": url, "ok": False}

    try:
        payload = fetch_json(url)
        normalized = normalize_strands_payload(payload, puzzle_date)
    except Exception as exc:
        source["error"] = str(exc)
        return {"ok": False, "source": source}

    source["ok"] = True
    return {"ok": True, "payload": payload, "source": source, **normalized}


def fetch_sudoku_source(puzzle_date: date) -> dict[str, Any]:
    url = SUDOKU_PAGE_URL
    source = {"id": "publisher", "url": url, "ok": False}

    if puzzle_date != get_puzzle_date():
        source["error"] = "Sudoku publisher page only exposes the current puzzle"
        return {"ok": False, "source": source}

    try:
        response = requests.get(
            url,
            headers={"User-Agent": USER_AGENT, "Accept": "text/html"},
            timeout=SOURCE_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        game_data = extract_sudoku_game_data(response.text)
        puzzles = normalize_sudoku_payload(game_data, puzzle_date)
    except Exception as exc:
        source["error"] = str(exc)
        return {"ok": False, "source": source}

    source["ok"] = True
    return {
        "ok": True,
        "display_date": normalize_text(game_data.get("displayDate"), max_length=80)
        or puzzle_date.isoformat(),
        "puzzles": puzzles,
        "source": source,
    }


def fetch_json(url: str) -> dict[str, Any]:
    response = requests.get(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=SOURCE_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError("Publisher response was not an object")
    return payload


def normalize_connections_payload(
    payload: dict[str, Any],
    puzzle_date: date,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if payload.get("print_date") != puzzle_date.isoformat():
        raise ValueError("Publisher date did not match requested date")

    raw_categories = payload.get("categories")
    if not isinstance(raw_categories, list) or len(raw_categories) != CONNECTIONS_GROUPS:
        raise ValueError("Connections payload had invalid categories")

    cards_by_position: dict[int, dict[str, Any]] = {}
    groups = []
    for rank, category in enumerate(raw_categories):
        if not isinstance(category, dict):
            raise ValueError("Connections category was invalid")

        title = normalize_text(category.get("title"), max_length=80)
        raw_cards = category.get("cards")
        if not title or not isinstance(raw_cards, list) or len(raw_cards) != CONNECTIONS_CARDS_PER_GROUP:
            raise ValueError("Connections category was incomplete")

        group_cards = []
        for card in raw_cards:
            if not isinstance(card, dict):
                raise ValueError("Connections card was invalid")
            content = normalize_text(card.get("content"), max_length=28).upper()
            position = int(card.get("position"))
            if not content or position < 0 or position >= 16:
                raise ValueError("Connections card was incomplete")
            group_cards.append(content)
            cards_by_position[position] = {
                "content": content,
                "id": f"connections-{puzzle_date.isoformat()}-{position}",
                "position": position,
            }

        groups.append({"cards": group_cards, "rank": rank, "title": title})

    if len(cards_by_position) != 16:
        raise ValueError("Connections payload did not contain sixteen unique cards")

    cards = [cards_by_position[position] for position in range(16)]
    return cards, groups


def normalize_strands_payload(payload: dict[str, Any], puzzle_date: date) -> dict[str, Any]:
    if payload.get("printDate") != puzzle_date.isoformat():
        raise ValueError("Publisher date did not match requested date")

    board = normalize_strands_board(payload.get("startingBoard"))
    theme_words = normalize_word_list(payload.get("themeWords"), min_count=1)
    spangram = normalize_text(payload.get("spangram"), max_length=32).upper()
    theme_paths = normalize_path_map(payload.get("themeCoords"), board)
    spangram_path = normalize_strands_path(payload.get("spangramCoords"), board)
    allowed_words = sorted(
        set(normalize_word_list(payload.get("solutions"), min_count=0) + theme_words + [spangram])
    )

    if not spangram:
        raise ValueError("Strands payload was missing a spangram")
    for word in theme_words:
        if word not in theme_paths:
            raise ValueError("Strands payload was missing a theme path")

    return {
        "allowed_words": allowed_words,
        "board": board,
        "spangram": spangram,
        "spangram_path": spangram_path,
        "theme_paths": theme_paths,
        "theme_words": theme_words,
    }


def extract_sudoku_game_data(raw_html: str) -> dict[str, Any]:
    match = re.search(
        r"window\.gameData\s*=\s*(\{.*?\})\s*</script>",
        raw_html,
        flags=re.DOTALL,
    )
    if not match:
        raise ValueError("Sudoku game data was missing")

    return json.loads(unescape(match.group(1)))


def normalize_sudoku_payload(
    payload: dict[str, Any],
    puzzle_date: date,
) -> dict[str, dict[str, Any]]:
    puzzles = {}
    for difficulty in SUDOKU_DIFFICULTIES:
        raw_puzzle = payload.get(difficulty)
        if not isinstance(raw_puzzle, dict):
            raise ValueError("Sudoku payload was missing a difficulty")
        if raw_puzzle.get("print_date") != puzzle_date.isoformat():
            raise ValueError("Sudoku publisher date did not match requested date")

        puzzle_data = raw_puzzle.get("puzzle_data")
        if not isinstance(puzzle_data, dict):
            raise ValueError("Sudoku puzzle data was missing")
        normalize_sudoku_numbers(puzzle_data.get("puzzle"), allow_zero=True)
        normalize_sudoku_numbers(puzzle_data.get("solution"), allow_zero=False)
        puzzles[difficulty] = raw_puzzle

    return puzzles


def create_connections_fallback(puzzle_date: date) -> dict[str, Any]:
    rng = random.Random(f"connections:{puzzle_date.isoformat()}")
    group_choices = list(CONNECTIONS_FALLBACK_GROUPS)
    rng.shuffle(group_choices)

    groups = []
    cards = []
    card_entries = []
    for rank, (title, group_cards) in enumerate(group_choices[:CONNECTIONS_GROUPS]):
        normalized_cards = list(group_cards)
        groups.append({"cards": normalized_cards, "rank": rank, "title": title})
        for content in normalized_cards:
            card_entries.append(content)

    positions = list(range(len(card_entries)))
    rng.shuffle(positions)
    for content, position in zip(card_entries, positions, strict=True):
        cards.append(
            {
                "content": content,
                "id": f"connections-{puzzle_date.isoformat()}-{position}",
                "position": position,
            }
        )

    cards.sort(key=lambda card: card["position"])
    return {"cards": cards, "groups": groups}


def create_strands_fallback(puzzle_date: date) -> dict[str, Any]:
    _ = puzzle_date
    return {
        "allowed_words": sorted(set(STRANDS_FALLBACK["solutions"])),
        "board": list(STRANDS_FALLBACK["startingBoard"]),
        "clue": STRANDS_FALLBACK["clue"],
        "spangram": STRANDS_FALLBACK["spangram"],
        "spangram_path": STRANDS_FALLBACK["spangramCoords"],
        "theme_paths": STRANDS_FALLBACK["themeCoords"],
        "theme_words": STRANDS_FALLBACK["themeWords"],
    }


def create_sudoku_fallback(puzzle_date: date, difficulty: str) -> dict[str, list[int]]:
    rng = random.Random(f"sudoku:{puzzle_date.isoformat()}:{difficulty}")
    base = 3
    side = base * base

    def pattern(row: int, column: int) -> int:
        return (base * (row % base) + row // base + column) % side

    def shuffle(sequence: range | list[int]) -> list[int]:
        values = list(sequence)
        rng.shuffle(values)
        return values

    row_groups = shuffle(range(base))
    rows = [group * base + row for group in row_groups for row in shuffle(range(base))]
    column_groups = shuffle(range(base))
    columns = [group * base + column for group in column_groups for column in shuffle(range(base))]
    numbers = shuffle(range(1, side + 1))
    solution = [numbers[pattern(row, column)] for row in rows for column in columns]

    givens_by_difficulty = {"easy": 43, "medium": 34, "hard": 28}
    givens = givens_by_difficulty[difficulty]
    keep_indices = set(rng.sample(range(side * side), givens))
    puzzle = [value if index in keep_indices else 0 for index, value in enumerate(solution)]
    return {"puzzle": puzzle, "solution": solution}


def serialize_connections(row) -> dict[str, Any]:
    return {
        "cards": json.loads(row["cards_json"]),
        "date": row["puzzle_date"],
        "editor": row["editor"],
        "externalId": row["external_id"],
        "groups": json.loads(row["groups_json"]),
        "source": json.loads(row["source_json"]),
        "status": row["status"],
    }


def serialize_strands(row) -> dict[str, Any]:
    return {
        "allowedWords": json.loads(row["allowed_words_json"]),
        "board": json.loads(row["board_json"]),
        "clue": row["clue"],
        "constructors": row["constructors"],
        "date": row["puzzle_date"],
        "editor": row["editor"],
        "externalId": row["external_id"],
        "source": json.loads(row["source_json"]),
        "spangram": row["spangram"],
        "spangramPath": json.loads(row["spangram_path_json"]),
        "status": row["status"],
        "themePaths": json.loads(row["theme_paths_json"]),
        "themeWords": json.loads(row["theme_words_json"]),
    }


def serialize_sudoku(row) -> dict[str, Any]:
    return {
        "date": row["puzzle_date"],
        "difficulty": row["difficulty"],
        "displayDate": row["display_date"],
        "externalId": row["external_id"],
        "puzzle": json.loads(row["puzzle_json"]),
        "solution": json.loads(row["solution_json"]),
        "source": json.loads(row["source_json"]),
        "status": row["status"],
    }


def serialize_multigame_user(row) -> dict[str, Any]:
    user = {
        "displayName": row["display_name"],
        "firstName": row["first_name"],
        "id": row["id"],
        "lastInitial": row["last_initial"],
    }
    avatar = decode_avatar_json(row["avatar_json"])
    if avatar is not None:
        user["avatar"] = avatar
    return user


def serialize_multigame_result(row) -> dict[str, Any]:
    result = {
        "completedAt": row["completed_at"],
        "date": row["puzzle_date"],
        "displayName": row["display_name"],
        "elapsedSeconds": row["elapsed_seconds"],
        "gameKey": row["game_key"],
        "id": row["id"],
        "outcome": row["outcome"],
        "score": json.loads(row["score_json"]),
        "userId": row["user_id"],
        "variant": row["puzzle_variant"],
    }
    avatar = decode_avatar_json(row["avatar_json"])
    if avatar is not None:
        result["avatar"] = avatar
    return result


def calculate_multigame_stats(results: list[dict[str, Any]]) -> dict[str, Any]:
    played = len(results)
    wins = sum(1 for result in results if result["outcome"] == "won")
    elapsed_values = [
        int(result["elapsedSeconds"])
        for result in results
        if result["outcome"] == "won" and result.get("elapsedSeconds") is not None
    ]
    return {
        "averageSeconds": round(sum(elapsed_values) / len(elapsed_values)) if elapsed_values else 0,
        "played": played,
        "solveRate": round((wins / played) * 100) if played else 0,
        "wins": wins,
    }


def empty_multigame_dashboard() -> dict[str, Any]:
    return {
        game_key: {"groupStats": calculate_multigame_stats([]), "users": []}
        for game_key in GAME_KEYS
    }


def public_connections_group(group: dict[str, Any]) -> dict[str, Any]:
    return {
        "cards": group["cards"],
        "rank": group["rank"],
        "title": group["title"],
    }


def normalize_connections_guess(raw_cards: object) -> list[str]:
    if not isinstance(raw_cards, list):
        return []

    cards = []
    for card in raw_cards:
        content = normalize_text(card, max_length=28).upper()
        if content:
            cards.append(content)

    return cards


def normalize_sudoku_difficulty(difficulty: str) -> str:
    normalized = difficulty.strip().casefold() if isinstance(difficulty, str) else "medium"
    if normalized not in SUDOKU_DIFFICULTIES:
        raise ValueError("Invalid Sudoku difficulty")
    return normalized


def normalize_sudoku_grid(raw_grid: object) -> list[int | None]:
    if not isinstance(raw_grid, list) or len(raw_grid) != 81:
        raise ValueError("Invalid Sudoku grid")

    grid = []
    for value in raw_grid:
        if value in {"", None, 0}:
            grid.append(None)
            continue
        if not isinstance(value, int) or value < 1 or value > 9:
            raise ValueError("Invalid Sudoku grid")
        grid.append(value)

    return grid


def normalize_sudoku_numbers(raw_values: object, *, allow_zero: bool) -> list[int]:
    if not isinstance(raw_values, list) or len(raw_values) != 81:
        raise ValueError("Invalid Sudoku puzzle")

    values = []
    minimum = 0 if allow_zero else 1
    for value in raw_values:
        if not isinstance(value, int) or value < minimum or value > 9:
            raise ValueError("Invalid Sudoku puzzle")
        values.append(value)

    return values


def normalize_strands_board(raw_board: object) -> list[str]:
    if not isinstance(raw_board, list) or not raw_board:
        raise ValueError("Invalid Strands board")

    board = []
    expected_width = None
    for row in raw_board:
        row_text = normalize_text(row, max_length=16).upper()
        if not row_text or not row_text.isalpha():
            raise ValueError("Invalid Strands board")
        if expected_width is None:
            expected_width = len(row_text)
        elif len(row_text) != expected_width:
            raise ValueError("Invalid Strands board")
        board.append(row_text)

    return board


def normalize_path_map(raw_paths: object, board: list[str]) -> dict[str, list[list[int]]]:
    if not isinstance(raw_paths, dict):
        raise ValueError("Invalid Strands paths")

    return {
        normalize_text(word, max_length=32).upper(): normalize_strands_path(path, board)
        for word, path in raw_paths.items()
    }


def normalize_strands_path(raw_path: object, board: list[str]) -> list[list[int]]:
    if not isinstance(raw_path, list) or not raw_path:
        raise ValueError("Invalid Strands path")

    height = len(board)
    width = len(board[0])
    path = []
    seen = set()
    previous = None
    for coord in raw_path:
        if (
            not isinstance(coord, list)
            or len(coord) != 2
            or not isinstance(coord[0], int)
            or not isinstance(coord[1], int)
        ):
            raise ValueError("Invalid Strands path")

        row, column = coord
        if row < 0 or row >= height or column < 0 or column >= width:
            raise ValueError("Invalid Strands path")
        if (row, column) in seen:
            raise ValueError("Invalid Strands path")
        if previous is not None and max(abs(previous[0] - row), abs(previous[1] - column)) > 1:
            raise ValueError("Letters must touch")

        seen.add((row, column))
        previous = (row, column)
        path.append([row, column])

    return path


def get_strands_path_word(board: list[str], path: list[list[int]]) -> str:
    return "".join(board[row][column] for row, column in path)


def normalize_word_list(raw_words: object, *, min_count: int) -> list[str]:
    if not isinstance(raw_words, list) or len(raw_words) < min_count:
        raise ValueError("Invalid word list")

    words = []
    for word in raw_words:
        normalized_word = normalize_text(word, max_length=32).upper()
        if normalized_word:
            words.append(normalized_word)

    if len(words) < min_count:
        raise ValueError("Invalid word list")

    return words


def normalize_text(raw_value: object, *, max_length: int) -> str:
    if not isinstance(raw_value, str):
        return ""

    return " ".join(raw_value.strip().split())[:max_length]
