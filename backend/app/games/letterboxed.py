"""NYT Letter Boxed fetch + play pipeline.

Sourcing mirrors Sudoku (NYT has no dated Letter Boxed endpoint): today comes
from the live puzzle page's ``window.gameData``; past days are recovered from an
Internet Archive snapshot of that page when a same-day capture exists; otherwise
a deterministic bundled fallback board is served. The raw board, NYT solution,
and per-day dictionary are cached in the separate Letter Boxed database.
"""
from __future__ import annotations

import json
import random
import re
from datetime import date, datetime
from html import unescape
from pathlib import Path
from typing import Any

import requests

from ..daily_answer import get_puzzle_date
from .common import (
    SOURCE_TIMEOUT_SECONDS,
    USER_AGENT,
    WAYBACK_AVAILABLE_URL,
    fetch_wayback_snapshot,
    normalize_text,
    wayback_candidate_timestamps,
)
from .letterboxed_db import connect_letterboxed


LETTERBOXED_PAGE_URL = "https://www.nytimes.com/puzzles/letter-boxed"
LETTERBOXED_WAYBACK_KEY = "nytimes.com/puzzles/letter-boxed"
# Third-party archive: complete date coverage and not rate-limited, unlike the
# Wayback Machine. It only publishes the board + NYT solution, so the validation
# dictionary is derived locally from the bundled word list.
LETTERBOXED_ANSWERS_URL = "https://letterboxedanswers.com/letter-boxed-{month}-{day}-{year}-answers/"

_WORDLIST_PATH = Path(__file__).with_name("letterboxed_words.txt")
_wordlist_cache: set[str] | None = None
LETTERBOXED_SIDES = 4
LETTERBOXED_LETTERS_PER_SIDE = 3
LETTERBOXED_TOTAL_LETTERS = LETTERBOXED_SIDES * LETTERBOXED_LETTERS_PER_SIDE
LETTERBOXED_MIN_WORD_LENGTH = 3

_FALLBACK_PATH = Path(__file__).with_name("letterboxed_fallback.json")


# --- Public entry points ----------------------------------------------------


def get_letterboxed_puzzle(puzzle_date: date, *, force_refresh: bool = False) -> dict[str, Any]:
    is_today_or_future = puzzle_date >= get_puzzle_date()
    if not force_refresh:
        cached = get_cached_letterboxed(puzzle_date)
        if cached is not None:
            if cached["status"] == "confirmed":
                return cached
            # A past date's real puzzle never changes, so keep retrying an archive
            # fetch to upgrade a generated fallback into the real board. For today,
            # back off 30 minutes so a flaky live page isn't hammered.
            if is_today_or_future:
                fetched_at = datetime.fromisoformat(cached["fetched_at"])
                age_seconds = (datetime.now().astimezone() - fetched_at).total_seconds()
                if age_seconds <= 60 * 30:
                    return cached

    if is_today_or_future:
        fetched = fetch_letterboxed_source()
    else:
        fetched = fetch_letterboxed_source_for_date(puzzle_date)

    if fetched["ok"] and fetched["puzzle_date"] == puzzle_date:
        return save_letterboxed_puzzle(status="confirmed", **_savable(fetched))

    cached_generated = get_cached_letterboxed(puzzle_date)
    if cached_generated is not None:
        update_letterboxed_cache_timestamp(puzzle_date)
        return cached_generated

    fallback = create_letterboxed_fallback(puzzle_date)
    return save_letterboxed_puzzle(
        status="generated",
        puzzle_date=puzzle_date,
        external_id="",
        editor="Wordbee",
        sides=fallback["sides"],
        our_solution=fallback["ourSolution"],
        par=fallback["par"],
        dictionary=fallback["dictionary"],
        display_date=puzzle_date.strftime("%B %-d, %Y"),
        source=fetched.get("source", {"id": "fallback", "ok": False}),
    )


def warm_letterboxed_puzzle(puzzle_date: date) -> dict[str, Any]:
    cached = get_cached_letterboxed(puzzle_date)
    if cached is not None and cached["status"] == "confirmed":
        return {"confirmed": True, "status": "cached", "fetchedAt": cached["fetched_at"]}

    fetched = fetch_letterboxed_source()
    if not fetched["ok"]:
        return {"confirmed": False, "status": "failed", "source": fetched["source"]}
    if fetched["puzzle_date"] != puzzle_date:
        return {
            "confirmed": False,
            "status": "date-mismatch",
            "fetchedDate": fetched["puzzle_date"].isoformat(),
        }

    saved = save_letterboxed_puzzle(status="confirmed", **_savable(fetched))
    return {"confirmed": True, "status": "fetched", "fetchedAt": saved["fetched_at"]}


def public_letterboxed_puzzle(puzzle: dict[str, Any]) -> dict[str, Any]:
    # Hide the dictionary and NYT solution; only the board and hint counts ship.
    return {
        "gameKey": "letterboxed",
        "date": puzzle["date"],
        "sides": puzzle["sides"],
        "par": puzzle["par"],
        "nytSolutionWordCount": len(puzzle["ourSolution"]),
        "editor": puzzle["editor"],
        "displayDate": puzzle["displayDate"],
        "status": puzzle["status"],
    }


def public_letterboxed_solution(puzzle: dict[str, Any]) -> dict[str, Any]:
    return {
        "sides": puzzle["sides"],
        "ourSolution": puzzle["ourSolution"],
        "par": puzzle["par"],
    }


def check_letterboxed_word(
    puzzle_date: date,
    raw_word: object,
    raw_previous: object = None,
) -> dict[str, Any]:
    puzzle = get_letterboxed_puzzle(puzzle_date)
    word = normalize_word(raw_word)
    if word is None or len(word) < LETTERBOXED_MIN_WORD_LENGTH:
        return {"valid": False, "reason": "too-short", "word": word or ""}

    sides = puzzle["sides"]
    if not word_is_spellable(word, sides):
        return {"valid": False, "reason": "not-on-board", "word": word}

    previous = normalize_word(raw_previous)
    if previous and word[0] != previous[-1]:
        return {"valid": False, "reason": "chain", "word": word}

    if word not in set(puzzle["dictionary"]):
        return {"valid": False, "reason": "not-a-word", "word": word}

    return {"valid": True, "word": word, "letters": sorted(set(word))}


def validate_letterboxed_solution(puzzle_date: date, raw_words: object) -> bool:
    """Server-side re-check that a submitted word list actually solves the board."""
    puzzle = get_letterboxed_puzzle(puzzle_date)
    words = normalize_word_list(raw_words)
    if not words:
        return False

    sides = puzzle["sides"]
    dictionary = set(puzzle["dictionary"])
    previous: str | None = None
    used: set[str] = set()
    for word in words:
        if len(word) < LETTERBOXED_MIN_WORD_LENGTH:
            return False
        if not word_is_spellable(word, sides):
            return False
        if word not in dictionary:
            return False
        if previous is not None and word[0] != previous[-1]:
            return False
        used.update(word)
        previous = word

    return used == set("".join(sides))


# --- Board rules ------------------------------------------------------------


def side_index_map(sides: list[str]) -> dict[str, int]:
    return {letter: index for index, side in enumerate(sides) for letter in side}


def word_is_spellable(word: str, sides: list[str]) -> bool:
    """A word is spellable when every letter is on the board and no two adjacent
    letters come from the same side (Letter Boxed's core constraint)."""
    letter_side = side_index_map(sides)
    previous_side = -1
    for letter in word:
        current_side = letter_side.get(letter, -1)
        if current_side == -1 or current_side == previous_side:
            return False
        previous_side = current_side
    return True


def normalize_word(raw_word: object) -> str | None:
    if not isinstance(raw_word, str):
        return None
    word = re.sub(r"[^A-Za-z]", "", raw_word).upper()
    return word or None


def normalize_word_list(raw_words: object) -> list[str]:
    if not isinstance(raw_words, list):
        return []
    words = []
    for raw_word in raw_words:
        word = normalize_word(raw_word)
        if word is None:
            return []
        words.append(word)
    return words


# --- Fetching ---------------------------------------------------------------


def fetch_letterboxed_source() -> dict[str, Any]:
    source = {"id": "publisher", "url": LETTERBOXED_PAGE_URL, "ok": False}
    try:
        response = requests.get(
            LETTERBOXED_PAGE_URL,
            headers={"User-Agent": USER_AGENT, "Accept": "text/html"},
            timeout=SOURCE_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        game_data = extract_letterboxed_game_data(response.text)
        parsed = normalize_letterboxed_payload(game_data)
    except Exception as exc:
        source["error"] = str(exc)
        return {"ok": False, "source": source}

    source["ok"] = True
    return {"ok": True, "source": source, **parsed}


def fetch_letterboxed_source_for_date(puzzle_date: date) -> dict[str, Any]:
    """Recover a past Letter Boxed board from any available source.

    The third-party answers archive is tried first (complete coverage, no rate
    limiting), then the Internet Archive (which carries NYT's own dictionary).
    """
    attempts: list[dict[str, Any]] = []
    for fetcher in (fetch_letterboxed_from_answers, fetch_letterboxed_from_wayback):
        result = fetcher(puzzle_date)
        if result["ok"]:
            return result
        attempts.append(result["source"])

    return {
        "ok": False,
        "source": {"id": "multi", "ok": False, "attempts": attempts, "error": "No source had this date"},
    }


def fetch_letterboxed_from_answers(puzzle_date: date) -> dict[str, Any]:
    """Fetch the board + NYT solution from letterboxedanswers.com and derive the
    validation dictionary locally from the bundled word list."""
    url = LETTERBOXED_ANSWERS_URL.format(
        month=puzzle_date.strftime("%B").lower(),
        day=puzzle_date.strftime("%d"),
        year=puzzle_date.year,
    )
    source: dict[str, Any] = {"id": "letterboxedanswers", "url": url, "ok": False}
    try:
        response = requests.get(
            url,
            headers={"User-Agent": USER_AGENT, "Accept": "text/html"},
            timeout=SOURCE_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        raw_sides, raw_solution = parse_answers_page(response.text)
        sides = normalize_sides(raw_sides)
        our_solution = normalize_word_list(raw_solution)
        if not our_solution or not solution_covers_board(our_solution, sides):
            raise ValueError("Answers-site solution failed validation")
        dictionary = derive_dictionary(sides, our_solution)
    except Exception as exc:
        source["error"] = str(exc)
        return {"ok": False, "source": source}

    source["ok"] = True
    return {
        "ok": True,
        "source": source,
        "puzzle_date": puzzle_date,
        "external_id": "",
        "editor": "New York Times",
        "sides": sides,
        "our_solution": our_solution,
        "par": len(our_solution),
        "dictionary": dictionary,
        "display_date": puzzle_date.strftime("%B %-d, %Y"),
    }


def parse_answers_page(html: str) -> tuple[list[str], list[str]]:
    text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"\s+", " ", text)
    match = re.search(
        r"Sides of this Letter Box(?:es)? (?:are|is)\s*:?\s*([A-Za-z ]+?)\s+"
        r"The answers? (?:are|is)\s*:?\s*([A-Za-z ]+?)\s+"
        r"(?:&larr;|Previous|Next|\d+\s+(?:thought|comment))",
        text,
    )
    if not match:
        raise ValueError("Answers page format not recognized")
    sides = [token for token in match.group(1).split() if token]
    words = [token for token in match.group(2).split() if token]
    return sides, words


def solution_covers_board(words: list[str], sides: list[str]) -> bool:
    """A word list is a legal Letter Boxed solution for this board."""
    previous: str | None = None
    used: set[str] = set()
    for word in words:
        if len(word) < LETTERBOXED_MIN_WORD_LENGTH or not word_is_spellable(word, sides):
            return False
        if previous is not None and word[0] != previous[-1]:
            return False
        used.update(word)
        previous = word
    return used == set("".join(sides))


def load_wordlist() -> set[str]:
    global _wordlist_cache
    if _wordlist_cache is None:
        try:
            with _WORDLIST_PATH.open(encoding="utf-8") as handle:
                _wordlist_cache = {line.strip().upper() for line in handle if line.strip()}
        except OSError:
            _wordlist_cache = set()
    return _wordlist_cache


def derive_dictionary(sides: list[str], extra_words: list[str]) -> list[str]:
    """Every bundled word spellable on this board, plus the NYT solution words."""
    words = {
        word
        for word in load_wordlist()
        if len(word) >= LETTERBOXED_MIN_WORD_LENGTH and word_is_spellable(word, sides)
    }
    words.update(word for word in extra_words if word)
    return sorted(words)


def fetch_letterboxed_from_wayback(puzzle_date: date) -> dict[str, Any]:
    """Recover a past Letter Boxed board from the Internet Archive.

    Probe several Wayback captures inside the requested day's puzzle window (see
    ``common.wayback_*``) and accept the first snapshot whose ``printDate`` matches
    exactly.
    """
    source: dict[str, Any] = {"id": "wayback", "url": WAYBACK_AVAILABLE_URL, "ok": False, "tried": []}

    for timestamp in wayback_candidate_timestamps(LETTERBOXED_WAYBACK_KEY, puzzle_date, source):
        try:
            html = fetch_wayback_snapshot(timestamp, LETTERBOXED_PAGE_URL)
            parsed = normalize_letterboxed_payload(extract_letterboxed_game_data(html))
        except Exception as exc:
            source["tried"].append({"timestamp": timestamp, "error": str(exc)})
            continue

        if parsed["puzzle_date"] != puzzle_date:
            source["tried"].append(
                {"timestamp": timestamp, "fetchedDate": parsed["puzzle_date"].isoformat()}
            )
            continue

        source["ok"] = True
        source["timestamp"] = timestamp
        return {"ok": True, "source": source, **parsed}

    if not source.get("error"):
        source["error"] = "No archived Letter Boxed snapshot matched this date"
    return {"ok": False, "source": source}


def extract_letterboxed_game_data(raw_html: str) -> dict[str, Any]:
    """Pull the ``window.gameData = {...}`` JSON out of the puzzle page.

    A brace-balanced scan (skipping string contents) is used instead of a regex so
    it works no matter what follows the object — a ``;``, a newline, another
    ``<script>`` statement, etc. This is the piece that most often breaks when the
    page markup shifts, so it is deliberately forgiving.
    """
    marker = re.search(r"window\.gameData\s*=\s*", raw_html)
    if marker is None:
        raise ValueError("Letter Boxed game data was missing")

    start = raw_html.find("{", marker.end())
    if start == -1:
        raise ValueError("Letter Boxed game data was malformed")

    depth = 0
    in_string = False
    escaped = False
    end = None
    for index in range(start, len(raw_html)):
        char = raw_html[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                end = index + 1
                break

    if end is None:
        raise ValueError("Letter Boxed game data was unbalanced")

    return json.loads(unescape(raw_html[start:end]))


def normalize_letterboxed_payload(payload: dict[str, Any]) -> dict[str, Any]:
    print_date = payload.get("printDate")
    if not isinstance(print_date, str):
        raise ValueError("Letter Boxed payload was missing a print date")
    puzzle_date = date.fromisoformat(print_date)

    sides = normalize_sides(payload.get("sides"))
    our_solution = normalize_word_list(payload.get("ourSolution"))
    if not our_solution:
        raise ValueError("Letter Boxed payload was missing a solution")

    dictionary = sorted({
        word
        for word in (normalize_word(entry) for entry in payload.get("dictionary") or [])
        if word and len(word) >= LETTERBOXED_MIN_WORD_LENGTH and word_is_spellable(word, sides)
    })
    # NYT always ships a rich dictionary; guarantee its own solution is inside it.
    dictionary = sorted(set(dictionary) | set(our_solution))
    if len(dictionary) < len(our_solution):
        raise ValueError("Letter Boxed payload had an empty dictionary")

    raw_par = payload.get("par")
    par = int(raw_par) if isinstance(raw_par, int) else len(our_solution)

    return {
        "puzzle_date": puzzle_date,
        "external_id": str(payload.get("id") or ""),
        "editor": normalize_text(payload.get("editor"), max_length=80) or "New York Times",
        "sides": sides,
        "our_solution": our_solution,
        "par": par,
        "dictionary": dictionary,
        "display_date": normalize_text(payload.get("date"), max_length=80) or puzzle_date.isoformat(),
    }


def normalize_sides(raw_sides: object) -> list[str]:
    if not isinstance(raw_sides, list) or len(raw_sides) != LETTERBOXED_SIDES:
        raise ValueError("Letter Boxed payload had invalid sides")

    sides = []
    for raw_side in raw_sides:
        side = normalize_word(raw_side)
        if side is None or len(side) != LETTERBOXED_LETTERS_PER_SIDE:
            raise ValueError("Letter Boxed side was not three letters")
        sides.append(side)

    if len(set("".join(sides))) != LETTERBOXED_TOTAL_LETTERS:
        raise ValueError("Letter Boxed board did not have twelve unique letters")
    return sides


# --- Fallback ---------------------------------------------------------------


def create_letterboxed_fallback(puzzle_date: date) -> dict[str, Any]:
    boards = load_fallback_boards()
    rng = random.Random(f"letterboxed:{puzzle_date.isoformat()}")
    board = rng.choice(boards)
    sides = normalize_sides(board["sides"])
    our_solution = normalize_word_list(board["ourSolution"])
    dictionary = sorted({
        word
        for word in (normalize_word(entry) for entry in board.get("dictionary") or [])
        if word and word_is_spellable(word, sides)
    } | set(our_solution))
    return {
        "sides": sides,
        "ourSolution": our_solution,
        "par": int(board.get("par") or len(our_solution)),
        "dictionary": dictionary,
    }


def load_fallback_boards() -> list[dict[str, Any]]:
    with _FALLBACK_PATH.open(encoding="utf-8") as handle:
        boards = json.load(handle)
    if not isinstance(boards, list) or not boards:
        raise RuntimeError("Letter Boxed fallback data was empty")
    return boards


# --- Persistence ------------------------------------------------------------


def get_cached_letterboxed(puzzle_date: date) -> dict[str, Any] | None:
    with connect_letterboxed() as connection:
        row = connection.execute(
            """
            SELECT puzzle_date, external_id, editor, sides_json, our_solution_json,
                   par, dictionary_json, display_date, status, source_json,
                   fetched_at, updated_at
            FROM daily_letterboxed
            WHERE puzzle_date = ?
            """,
            (puzzle_date.isoformat(),),
        ).fetchone()
    return serialize_letterboxed(row) if row else None


def save_letterboxed_puzzle(
    *,
    puzzle_date: date,
    external_id: str,
    editor: str,
    sides: list[str],
    our_solution: list[str],
    par: int,
    dictionary: list[str],
    display_date: str,
    status: str,
    source: dict[str, Any],
) -> dict[str, Any]:
    now = datetime.now().astimezone().isoformat()
    with connect_letterboxed() as connection:
        connection.execute(
            """
            INSERT INTO daily_letterboxed (
              puzzle_date, external_id, editor, sides_json, our_solution_json,
              par, dictionary_json, display_date, status, source_json,
              fetched_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(puzzle_date) DO UPDATE SET
              external_id = excluded.external_id,
              editor = excluded.editor,
              sides_json = excluded.sides_json,
              our_solution_json = excluded.our_solution_json,
              par = excluded.par,
              dictionary_json = excluded.dictionary_json,
              display_date = excluded.display_date,
              status = excluded.status,
              source_json = excluded.source_json,
              fetched_at = excluded.fetched_at,
              updated_at = excluded.updated_at
            """,
            (
                puzzle_date.isoformat(),
                external_id,
                editor,
                json.dumps(sides, separators=(",", ":")),
                json.dumps(our_solution, separators=(",", ":")),
                int(par),
                json.dumps(dictionary, separators=(",", ":")),
                display_date,
                status,
                json.dumps(source, separators=(",", ":")),
                now,
                now,
            ),
        )

    cached = get_cached_letterboxed(puzzle_date)
    if cached is None:
        raise RuntimeError("Unable to cache Letter Boxed puzzle")
    return cached


def update_letterboxed_cache_timestamp(puzzle_date: date) -> None:
    now = datetime.now().astimezone().isoformat()
    with connect_letterboxed() as connection:
        connection.execute(
            """
            UPDATE daily_letterboxed
            SET fetched_at = ?, updated_at = ?
            WHERE puzzle_date = ?
            """,
            (now, now, puzzle_date.isoformat()),
        )


def serialize_letterboxed(row) -> dict[str, Any]:
    return {
        "date": row["puzzle_date"],
        "externalId": row["external_id"],
        "editor": row["editor"],
        "sides": json.loads(row["sides_json"]),
        "ourSolution": json.loads(row["our_solution_json"]),
        "par": row["par"],
        "dictionary": json.loads(row["dictionary_json"]),
        "displayDate": row["display_date"],
        "status": row["status"],
        "source": json.loads(row["source_json"]),
        "fetched_at": row["fetched_at"],
    }


def _savable(fetched: dict[str, Any]) -> dict[str, Any]:
    return {
        "puzzle_date": fetched["puzzle_date"],
        "external_id": fetched["external_id"],
        "editor": fetched["editor"],
        "sides": fetched["sides"],
        "our_solution": fetched["our_solution"],
        "par": fetched["par"],
        "dictionary": fetched["dictionary"],
        "display_date": fetched["display_date"],
        "source": fetched["source"],
    }
