from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any

from ..db import connect_game
from .common import PUBLISHER_BASE_URL, fetch_json, normalize_text


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


def get_strands_puzzle(puzzle_date: date, *, force_refresh: bool = False) -> dict[str, Any]:
    if not force_refresh:
        cached = get_cached_strands(puzzle_date)
        if cached is not None:
            if cached["status"] == "confirmed":
                return cached
            fetched_at = datetime.fromisoformat(cached["fetched_at"])
            age_seconds = (datetime.now().astimezone() - fetched_at).total_seconds()
            if age_seconds <= 60 * 30:
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

    cached_generated = get_cached_strands(puzzle_date)
    if cached_generated is not None:
        update_strands_cache_timestamp(puzzle_date)
        return cached_generated

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


def warm_strands_puzzle(puzzle_date: date) -> dict[str, Any]:
    cached = get_cached_strands(puzzle_date)
    if cached is not None and cached["status"] == "confirmed":
        return {"confirmed": True, "status": "cached", "fetchedAt": cached["fetched_at"]}

    fetched = fetch_strands_source(puzzle_date)
    if not fetched["ok"]:
        return {"confirmed": False, "status": "failed", "source": fetched["source"]}

    payload = fetched["payload"]
    saved = save_strands_puzzle(
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
    return {"confirmed": True, "status": "fetched", "fetchedAt": saved["fetched_at"]}


def check_strands_guess(puzzle_date: date, raw_path: object) -> dict[str, Any]:
    puzzle = get_strands_puzzle(puzzle_date)
    path = normalize_strands_path(raw_path, puzzle["board"])
    # Words are only valid read forwards along the traced path (like NYT).
    word = get_strands_path_word(puzzle["board"], path)
    theme_words = {theme_word.upper(): theme_word for theme_word in puzzle["themeWords"]}

    if word == puzzle["spangram"]:
        return {
            "valid": True,
            "kind": "spangram",
            "word": puzzle["spangram"],
            "path": puzzle["spangramPath"],
        }

    if word in theme_words:
        return {
            "valid": True,
            "kind": "theme",
            "word": word,
            "path": puzzle["themePaths"][word],
        }

    allowed_words = set(puzzle["allowedWords"])
    if len(word) >= 4 and word in allowed_words:
        return {
            "valid": True,
            "kind": "bonus",
            "word": word,
            "path": path,
        }

    return {"valid": False, "kind": "invalid", "word": word}


def get_strands_hint(puzzle_date: date, raw_found_theme_words: object) -> dict[str, Any]:
    """Return the path of the next unsolved theme word so the UI can circle it."""
    puzzle = get_strands_puzzle(puzzle_date)
    found = set()
    if isinstance(raw_found_theme_words, list):
        found = {
            str(word).strip().upper()
            for word in raw_found_theme_words
            if isinstance(word, str)
        }
    for word in puzzle["themeWords"]:
        if word.upper() not in found:
            return {"word": word, "path": puzzle["themePaths"][word]}
    return {"word": "", "path": []}


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


def get_cached_strands(puzzle_date: date) -> dict[str, Any] | None:
    with connect_game("strands") as connection:
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
    with connect_game("strands") as connection:
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


def update_strands_cache_timestamp(puzzle_date: date) -> None:
    now = datetime.now().astimezone().isoformat()
    with connect_game("strands") as connection:
        connection.execute(
            """
            UPDATE daily_strands
            SET fetched_at = ?, updated_at = ?
            WHERE puzzle_date = ?
            """,
            (now, now, puzzle_date.isoformat()),
        )


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
        "fetched_at": row["fetched_at"],
    }


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
