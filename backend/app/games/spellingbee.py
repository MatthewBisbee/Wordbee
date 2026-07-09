"""NYT Spelling Bee fetch + play pipeline.

Sourcing mirrors Letter Boxed (NYT has no dated Spelling Bee endpoint): today
comes from the live puzzle page's ``window.gameData`` (which conveniently also
carries the previous two weeks, so those days are cached opportunistically); past
days are recovered from nytbee.com — a complete, un-throttled third-party archive
— and, failing that, an Internet Archive snapshot of the NYT page; otherwise a
bundled fallback board is served. The raw board, pangrams, and full official
answer list are cached in the separate Spelling Bee database.

The board's centre letter, outer letters, and pangrams are *derived* from the
official answer list: every valid answer contains the centre letter (so it is the
one letter common to all answers), the seven valid letters are exactly those used
across all answers, and a pangram is any answer that uses all seven. This lets a
source that only publishes the answer list (nytbee.com) still yield a complete,
playable board.
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
from .spellingbee_db import connect_spellingbee


SPELLINGBEE_PAGE_URL = "https://www.nytimes.com/puzzles/spelling-bee"
SPELLINGBEE_WAYBACK_KEY = "nytimes.com/puzzles/spelling-bee"
# Third-party archive: complete date coverage back to the game's launch and not
# rate-limited, unlike the Wayback Machine. It publishes only the official answer
# list, from which the board and pangrams are derived (see module docstring).
NYTBEE_URL = "https://nytbee.com/Bee_{yyyymmdd}.html"

SPELLINGBEE_LETTER_COUNT = 7
SPELLINGBEE_MIN_WORD_LENGTH = 4
SPELLINGBEE_PANGRAM_BONUS = 7

# NYT's rank ladder: (title, percentage-of-max-score threshold). "Queen Bee"
# (100%) is only reachable by finding every answer. Mirrors the values baked into
# the live game (see External References/SpellingBee_files/spelling-bee.*.js).
RANK_TIERS: list[tuple[str, int]] = [
    ("Beginner", 0),
    ("Good Start", 2),
    ("Moving Up", 5),
    ("Good", 8),
    ("Solid", 15),
    ("Nice", 25),
    ("Great", 40),
    ("Amazing", 50),
    ("Genius", 70),
    ("Queen Bee", 100),
]
GENIUS_RANK_INDEX = 8

_FALLBACK_PATH = Path(__file__).with_name("spellingbee_fallback.json")


# --- Public entry points ----------------------------------------------------


def get_spellingbee_puzzle(puzzle_date: date, *, force_refresh: bool = False) -> dict[str, Any]:
    is_today_or_future = puzzle_date >= get_puzzle_date()
    if not force_refresh:
        cached = get_cached_spellingbee(puzzle_date)
        if cached is not None:
            if cached["status"] == "confirmed":
                return cached
            # A past date's real puzzle never changes, so keep retrying a fetch to
            # upgrade a generated fallback into the real board. For today, back off
            # 30 minutes so a flaky live page isn't hammered.
            if is_today_or_future:
                fetched_at = datetime.fromisoformat(cached["fetched_at"])
                age_seconds = (datetime.now().astimezone() - fetched_at).total_seconds()
                if age_seconds <= 60 * 30:
                    return cached

    if is_today_or_future:
        fetched = fetch_spellingbee_source()
        # The live page also carries the past ~two weeks; cache them for free.
        if fetched["ok"]:
            _cache_bonus_days(fetched.get("others", []))
    else:
        fetched = fetch_spellingbee_source_for_date(puzzle_date)

    if fetched["ok"] and fetched["puzzle_date"] == puzzle_date:
        return save_spellingbee_puzzle(status="confirmed", **_savable(fetched))

    cached_generated = get_cached_spellingbee(puzzle_date)
    if cached_generated is not None:
        update_spellingbee_cache_timestamp(puzzle_date)
        return cached_generated

    fallback = create_spellingbee_fallback(puzzle_date)
    return save_spellingbee_puzzle(
        status="generated",
        puzzle_date=puzzle_date,
        external_id="",
        editor="Wordbee",
        center_letter=fallback["centerLetter"],
        outer_letters=fallback["outerLetters"],
        valid_letters=fallback["validLetters"],
        pangrams=fallback["pangrams"],
        answers=fallback["answers"],
        display_date=puzzle_date.strftime("%B %-d, %Y"),
        source=fetched.get("source", {"id": "fallback", "ok": False}),
    )


def warm_spellingbee_puzzle(puzzle_date: date) -> dict[str, Any]:
    cached = get_cached_spellingbee(puzzle_date)
    if cached is not None and cached["status"] == "confirmed":
        return {"confirmed": True, "status": "cached", "fetchedAt": cached["fetched_at"]}

    fetched = fetch_spellingbee_source()
    if not fetched["ok"]:
        return {"confirmed": False, "status": "failed", "source": fetched["source"]}
    _cache_bonus_days(fetched.get("others", []))
    if fetched["puzzle_date"] != puzzle_date:
        return {
            "confirmed": False,
            "status": "date-mismatch",
            "fetchedDate": fetched["puzzle_date"].isoformat(),
        }

    saved = save_spellingbee_puzzle(status="confirmed", **_savable(fetched))
    return {"confirmed": True, "status": "fetched", "fetchedAt": saved["fetched_at"]}


def public_spellingbee_puzzle(puzzle: dict[str, Any]) -> dict[str, Any]:
    # Hide the answer list and pangram words; only the board and its derived
    # scoring targets ship to the client (answers are validated server-side).
    max_score = puzzle_max_score(puzzle["answers"], puzzle["pangrams"])
    return {
        "gameKey": "spellingbee",
        "date": puzzle["date"],
        "centerLetter": puzzle["centerLetter"],
        "outerLetters": puzzle["outerLetters"],
        "validLetters": puzzle["validLetters"],
        "editor": puzzle["editor"],
        "displayDate": puzzle["displayDate"],
        "status": puzzle["status"],
        "totalWords": len(puzzle["answers"]),
        "totalPangrams": len(puzzle["pangrams"]),
        "maxScore": max_score,
        "ranks": compute_ranks(max_score),
    }


def check_spellingbee_word(puzzle_date: date, raw_word: object) -> dict[str, Any]:
    """Validate a single guess against the day's official answer list."""
    puzzle = get_spellingbee_puzzle(puzzle_date)
    word = normalize_word(raw_word)
    if word is None:
        return {"valid": False, "reason": "empty", "word": ""}
    if len(word) < SPELLINGBEE_MIN_WORD_LENGTH:
        return {"valid": False, "reason": "too-short", "word": word}
    if puzzle["centerLetter"] not in word:
        return {"valid": False, "reason": "missing-center", "word": word}

    valid_letters = set(puzzle["validLetters"])
    if not set(word) <= valid_letters:
        return {"valid": False, "reason": "bad-letters", "word": word}

    if word not in set(puzzle["answers"]):
        return {"valid": False, "reason": "not-a-word", "word": word}

    is_pangram = word in set(puzzle["pangrams"])
    return {
        "valid": True,
        "word": word,
        "score": word_score(word, is_pangram),
        "isPangram": is_pangram,
    }


def summarize_progress(puzzle: dict[str, Any], raw_words: object) -> dict[str, Any]:
    """Fold a set of found words into the stored score/rank aggregate.

    Only real answers count; the input is de-duplicated and clamped to the day's
    answer list so a client (or a stale cross-device sync) can never inflate a
    score. This is the canonical shape persisted in ``score_json``.
    """
    answers = set(puzzle["answers"])
    pangrams = set(puzzle["pangrams"])
    found = sorted(
        {word for word in normalize_word_list(raw_words) if word in answers}
    )
    score = sum(word_score(word, word in pangrams) for word in found)
    max_score = puzzle_max_score(puzzle["answers"], puzzle["pangrams"])
    ranks = compute_ranks(max_score)
    rank_index = rank_index_for_score(score, ranks)
    pangrams_found = sum(1 for word in found if word in pangrams)
    is_queen_bee = len(found) == len(answers) and len(answers) > 0
    return {
        "words": found,
        "wordCount": len(found),
        "score": score,
        "maxScore": max_score,
        "rank": ranks[rank_index]["title"],
        "rankIndex": rank_index,
        "totalWords": len(answers),
        "pangramsFound": pangrams_found,
        "totalPangrams": len(pangrams),
        "isQueenBee": is_queen_bee,
        "percent": round((score / max_score) * 100) if max_score else 0,
        "reachedGenius": rank_index >= GENIUS_RANK_INDEX,
    }


# --- Scoring & ranks --------------------------------------------------------


def word_score(word: str, is_pangram: bool) -> int:
    """NYT scoring: 4-letter words are 1 point, longer words score their length,
    and a pangram earns a further seven-point bonus."""
    if len(word) < 5:
        return 1
    return len(word) + (SPELLINGBEE_PANGRAM_BONUS if is_pangram else 0)


def puzzle_max_score(answers: list[str], pangrams: list[str]) -> int:
    pangram_set = set(pangrams)
    return sum(word_score(word, word in pangram_set) for word in answers)


def compute_ranks(max_score: int) -> list[dict[str, Any]]:
    return [
        {"title": title, "minScore": round(percent / 100 * max_score)}
        for title, percent in RANK_TIERS
    ]


def rank_index_for_score(score: int, ranks: list[dict[str, Any]]) -> int:
    index = 0
    for candidate, rank in enumerate(ranks):
        if score >= rank["minScore"]:
            index = candidate
        else:
            break
    return index


# --- Board derivation & normalization ---------------------------------------


def normalize_word(raw_word: object) -> str | None:
    if not isinstance(raw_word, str):
        return None
    word = re.sub(r"[^a-z]", "", raw_word.lower())
    return word or None


def normalize_word_list(raw_words: object) -> list[str]:
    if not isinstance(raw_words, list):
        return []
    words = []
    for raw_word in raw_words:
        word = normalize_word(raw_word)
        if word is not None:
            words.append(word)
    return words


def normalize_answers(raw_answers: object) -> list[str]:
    """Clean, de-duplicate, and sort a raw answer list into playable answers."""
    words = sorted(
        {
            word
            for word in normalize_word_list(raw_answers)
            if len(word) >= SPELLINGBEE_MIN_WORD_LENGTH and len(set(word)) <= SPELLINGBEE_LETTER_COUNT
        }
    )
    return words


def derive_board(answers: list[str]) -> dict[str, Any]:
    """Derive the seven letters, centre letter, and pangrams from the answers.

    Every Spelling Bee answer contains the centre letter, so it is the single
    letter common to every answer; the seven valid letters are exactly those used
    across all answers; a pangram is any answer using all seven.
    """
    if len(answers) < 2:
        raise ValueError("Spelling Bee answer list was too short to derive a board")

    valid_letters = set().union(*(set(word) for word in answers))
    if len(valid_letters) != SPELLINGBEE_LETTER_COUNT:
        raise ValueError(
            f"Spelling Bee answers used {len(valid_letters)} letters, expected {SPELLINGBEE_LETTER_COUNT}"
        )

    common = set(answers[0])
    for word in answers[1:]:
        common &= set(word)
    if len(common) != 1:
        raise ValueError("Could not derive a single Spelling Bee centre letter")

    center_letter = next(iter(common))
    outer_letters = sorted(valid_letters - common)
    pangrams = sorted(word for word in answers if set(word) == valid_letters)
    if not pangrams:
        raise ValueError("Spelling Bee board had no pangram")

    return {
        "centerLetter": center_letter,
        "outerLetters": outer_letters,
        "validLetters": [center_letter, *outer_letters],
        "pangrams": pangrams,
    }


def normalize_nyt_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Normalize one day out of NYT's ``window.gameData`` (today/yesterday/etc.)."""
    print_date = payload.get("printDate")
    if not isinstance(print_date, str):
        raise ValueError("Spelling Bee payload was missing a print date")
    puzzle_date = date.fromisoformat(print_date)

    answers = normalize_answers(payload.get("answers"))
    if not answers:
        raise ValueError("Spelling Bee payload was missing answers")

    # NYT gives the board explicitly, but deriving it from the answers keeps the
    # invariant identical to the nytbee-derived path and catches malformed data.
    board = derive_board(answers)
    center_letter = normalize_word(payload.get("centerLetter"))
    if center_letter and center_letter != board["centerLetter"]:
        raise ValueError("Spelling Bee centre letter did not match its answers")

    return {
        "puzzle_date": puzzle_date,
        "external_id": str(payload.get("id") or ""),
        "editor": normalize_text(payload.get("editor"), max_length=80) or "New York Times",
        "answers": answers,
        "display_date": normalize_text(payload.get("displayDate"), max_length=80)
        or puzzle_date.strftime("%B %-d, %Y"),
        **{
            "center_letter": board["centerLetter"],
            "outer_letters": board["outerLetters"],
            "valid_letters": board["validLetters"],
            "pangrams": board["pangrams"],
        },
    }


# --- Fetching ---------------------------------------------------------------


def fetch_spellingbee_source() -> dict[str, Any]:
    """Fetch today's board (plus the past ~two weeks) from the live NYT page."""
    source = {"id": "publisher", "url": SPELLINGBEE_PAGE_URL, "ok": False}
    try:
        response = requests.get(
            SPELLINGBEE_PAGE_URL,
            headers={"User-Agent": USER_AGENT, "Accept": "text/html"},
            timeout=SOURCE_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        game_data = extract_spellingbee_game_data(response.text)
        today = normalize_nyt_payload(game_data["today"])
        others = _normalize_nyt_bonus_days(game_data)
    except Exception as exc:  # noqa: BLE001 - surfaced in the source diagnostics
        source["error"] = str(exc)
        return {"ok": False, "source": source}

    source["ok"] = True
    return {"ok": True, "source": source, "others": others, **today}


def _normalize_nyt_bonus_days(game_data: dict[str, Any]) -> list[dict[str, Any]]:
    """Every extra day carried in ``window.gameData`` (yesterday + past weeks)."""
    past = game_data.get("pastPuzzles") or {}
    raw_days: list[Any] = []
    for key in ("yesterday",):
        if isinstance(game_data.get(key), dict):
            raw_days.append(game_data[key])
    for key in ("thisWeek", "lastWeek"):
        section = past.get(key)
        if isinstance(section, list):
            raw_days.extend(section)

    days: dict[date, dict[str, Any]] = {}
    for raw_day in raw_days:
        if not isinstance(raw_day, dict):
            continue
        try:
            normalized = normalize_nyt_payload(raw_day)
        except Exception:  # noqa: BLE001 - a single bad bonus day shouldn't abort
            continue
        days[normalized["puzzle_date"]] = normalized
    return list(days.values())


def fetch_spellingbee_source_for_date(puzzle_date: date) -> dict[str, Any]:
    """Recover a past Spelling Bee board from any available source.

    nytbee.com is tried first (complete coverage, no rate limiting), then
    sbsolver.com, then the Internet Archive snapshot of the NYT page.
    """
    attempts: list[dict[str, Any]] = []
    for fetcher in (fetch_spellingbee_from_nytbee, fetch_spellingbee_from_sbsolver, fetch_spellingbee_from_wayback):
        result = fetcher(puzzle_date)
        if result["ok"]:
            return result
        attempts.append(result["source"])

    return {
        "ok": False,
        "source": {"id": "multi", "ok": False, "attempts": attempts, "error": "No source had this date"},
    }


def fetch_spellingbee_from_sbsolver(puzzle_date: date) -> dict[str, Any]:
    """Recover past Spelling Bee board from sbsolver.com and derive the board."""
    first_date = date(2018, 5, 9)
    puzzle_id = (puzzle_date - first_date).days + 1
    if puzzle_id < 1:
        return {
            "ok": False,
            "source": {"id": "sbsolver", "error": "Date precedes game launch", "ok": False},
        }

    url = f"https://www.sbsolver.com/s/{puzzle_id}"
    source = {"id": "sbsolver", "url": url, "ok": False}
    try:
        response = requests.get(
            url,
            headers={"User-Agent": USER_AGENT, "Accept": "text/html"},
            timeout=SOURCE_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        html = response.text

        # Extract value="Tiklnwy" or similar from the html
        # Pattern: id="string" name="string" value="([a-zA-Z]{7})"
        match = re.search(r'id=["\']?string["\']?[^>]*value=["\']?([a-zA-Z]{7})["\']?', html)
        if not match:
            match = re.search(r'value=["\']?([a-zA-Z]{7})["\']?[^>]*id=["\']?string["\']?', html)
            if not match:
                match = re.search(r'value=["\']?([a-zA-Z]{7})["\']?', html)

        if not match:
            raise ValueError("Could not find letter string in sbsolver HTML")

        string_val = match.group(1)

        # Center letter is the capital letter
        center_letter_list = [c.lower() for c in string_val if c.isupper()]
        if not center_letter_list:
            center_letter = string_val[0].lower()
        else:
            center_letter = center_letter_list[0]

        all_letters = string_val.lower()
        outer_letters = sorted(list(set(all_letters) - {center_letter}))
        valid_letters = sorted(list(set(all_letters)))

        words = re.findall(r'href="[^"]*/h/([a-z]+)"', html)
        # De-duplicate words while keeping order
        answers = []
        seen = set()
        for w in words:
            w_lower = w.lower()
            if w_lower not in seen:
                seen.add(w_lower)
                answers.append(w_lower)

        if not answers:
            raise ValueError("sbsolver page had no answers")

        # Find pangrams
        pangrams = sorted(word for word in answers if len(set(word)) == 7)
        if not pangrams:
            raise ValueError("No pangram found in answers")

    except Exception as exc:  # noqa: BLE001 - recorded for diagnostics
        source["error"] = str(exc)
        return {"ok": False, "source": source}

    source["ok"] = True
    return {
        "ok": True,
        "source": source,
        "puzzle_date": puzzle_date,
        "external_id": str(puzzle_id),
        "editor": "New York Times",
        "answers": answers,
        "display_date": puzzle_date.strftime("%B %-d, %Y"),
        "center_letter": center_letter,
        "outer_letters": outer_letters,
        "valid_letters": valid_letters,
        "pangrams": pangrams,
    }


def fetch_spellingbee_from_nytbee(puzzle_date: date) -> dict[str, Any]:
    """Fetch the official answer list from nytbee.com and derive the board."""
    url = NYTBEE_URL.format(yyyymmdd=puzzle_date.strftime("%Y%m%d"))
    source: dict[str, Any] = {"id": "nytbee", "url": url, "ok": False}
    try:
        response = requests.get(
            url,
            headers={"User-Agent": USER_AGENT, "Accept": "text/html"},
            timeout=SOURCE_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        answers = normalize_answers(parse_nytbee_answers(response.text))
        if not answers:
            raise ValueError("nytbee page had no answers")
        board = derive_board(answers)
    except Exception as exc:  # noqa: BLE001 - recorded for diagnostics
        source["error"] = str(exc)
        return {"ok": False, "source": source}

    source["ok"] = True
    return {
        "ok": True,
        "source": source,
        "puzzle_date": puzzle_date,
        "external_id": "",
        "editor": "New York Times",
        "answers": answers,
        "display_date": puzzle_date.strftime("%B %-d, %Y"),
        "center_letter": board["centerLetter"],
        "outer_letters": board["outerLetters"],
        "valid_letters": board["validLetters"],
        "pangrams": board["pangrams"],
    }


def parse_nytbee_answers(html: str) -> list[str]:
    """Pull the official answers out of nytbee's ``#main-answer-list`` block.

    Only the ``main-answer-list`` div holds the official NYT answers; the page
    also lists non-official and dictionary-only words in sibling blocks, which
    are deliberately ignored.
    """
    marker = re.search(r'id=["\']?main-answer-list["\']?', html)
    if marker is None:
        # Fall back to the older layout class name
        marker = re.search(r'class=["\']?answer-list["\']?', html)
        if marker is None:
            raise ValueError("nytbee answer list was missing")

    end = html.find("</ul>", marker.end())
    block = html[marker.end() : end if end != -1 else len(html)]
    # Pangrams are emphasised (e.g. ``<li><mark><strong>word</strong></mark></li>``),
    # so take each item's text content rather than a bare-word match.
    items = re.findall(r"<li[^>]*>(.*?)</li>", block, re.DOTALL)
    return [re.sub(r"<[^>]+>", " ", unescape(item)) for item in items]


def fetch_spellingbee_from_wayback(puzzle_date: date) -> dict[str, Any]:
    """Recover a past Spelling Bee board from an Internet Archive snapshot.

    Probe several Wayback captures inside the requested day's puzzle window (see
    ``common.wayback_*``) and accept the first whose ``today.printDate`` matches.
    """
    source: dict[str, Any] = {"id": "wayback", "url": WAYBACK_AVAILABLE_URL, "ok": False, "tried": []}

    for timestamp in wayback_candidate_timestamps(SPELLINGBEE_WAYBACK_KEY, puzzle_date, source):
        try:
            html = fetch_wayback_snapshot(timestamp, SPELLINGBEE_PAGE_URL)
            game_data = extract_spellingbee_game_data(html)
            parsed = _match_wayback_day(game_data, puzzle_date)
        except Exception as exc:  # noqa: BLE001 - recorded for diagnostics
            source["tried"].append({"timestamp": timestamp, "error": str(exc)})
            continue

        if parsed is None:
            source["tried"].append({"timestamp": timestamp, "note": "date-not-present"})
            continue

        source["ok"] = True
        source["timestamp"] = timestamp
        return {"ok": True, "source": source, **parsed}

    if not source.get("error"):
        source["error"] = "No archived Spelling Bee snapshot matched this date"
    return {"ok": False, "source": source}


def _match_wayback_day(game_data: dict[str, Any], puzzle_date: date) -> dict[str, Any] | None:
    """A single archived page carries ~two weeks; find the requested day in it."""
    candidates: list[Any] = []
    for key in ("today", "yesterday"):
        if isinstance(game_data.get(key), dict):
            candidates.append(game_data[key])
    past = game_data.get("pastPuzzles") or {}
    for key in ("today", "yesterday", "thisWeek", "lastWeek"):
        section = past.get(key)
        if isinstance(section, dict):
            candidates.append(section)
        elif isinstance(section, list):
            candidates.extend(section)

    for raw_day in candidates:
        if not isinstance(raw_day, dict) or raw_day.get("printDate") != puzzle_date.isoformat():
            continue
        try:
            return normalize_nyt_payload(raw_day)
        except Exception:  # noqa: BLE001 - keep probing other captures
            return None
    return None


def extract_spellingbee_game_data(raw_html: str) -> dict[str, Any]:
    """Pull the ``window.gameData = {...}`` JSON out of the puzzle page.

    A brace-balanced scan (skipping string contents) is used instead of a regex so
    it works no matter what follows the object — a ``;``, a newline, another
    ``<script>`` statement, etc. Shared logic with Letter Boxed's extractor.
    """
    marker = re.search(r"window\.gameData\s*=\s*", raw_html)
    if marker is None:
        raise ValueError("Spelling Bee game data was missing")

    start = raw_html.find("{", marker.end())
    if start == -1:
        raise ValueError("Spelling Bee game data was malformed")

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
        raise ValueError("Spelling Bee game data was unbalanced")

    data = json.loads(unescape(raw_html[start:end]))
    if not isinstance(data, dict) or "today" not in data:
        raise ValueError("Spelling Bee game data was not in the expected shape")
    return data


# --- Fallback ---------------------------------------------------------------


def create_spellingbee_fallback(puzzle_date: date) -> dict[str, Any]:
    boards = load_fallback_boards()
    rng = random.Random(f"spellingbee:{puzzle_date.isoformat()}")
    board = rng.choice(boards)
    answers = normalize_answers(board["answers"])
    derived = derive_board(answers)
    return {"answers": answers, **derived}


def load_fallback_boards() -> list[dict[str, Any]]:
    with _FALLBACK_PATH.open(encoding="utf-8") as handle:
        boards = json.load(handle)
    if not isinstance(boards, list) or not boards:
        raise RuntimeError("Spelling Bee fallback data was empty")
    return boards


# --- Persistence ------------------------------------------------------------


def _cache_bonus_days(days: list[dict[str, Any]]) -> None:
    """Persist opportunistically-fetched past days that aren't already confirmed."""
    for day in days:
        existing = get_cached_spellingbee(day["puzzle_date"])
        if existing is not None and existing["status"] == "confirmed":
            continue
        try:
            save_spellingbee_puzzle(
                status="confirmed",
                puzzle_date=day["puzzle_date"],
                external_id=day["external_id"],
                editor=day["editor"],
                center_letter=day["center_letter"],
                outer_letters=day["outer_letters"],
                valid_letters=day["valid_letters"],
                pangrams=day["pangrams"],
                answers=day["answers"],
                display_date=day["display_date"],
                source={"id": "publisher-bonus", "ok": True},
            )
        except Exception:  # noqa: BLE001 - best-effort background caching
            continue


def get_cached_spellingbee(puzzle_date: date) -> dict[str, Any] | None:
    with connect_spellingbee() as connection:
        row = connection.execute(
            """
            SELECT puzzle_date, external_id, editor, center_letter, outer_letters_json,
                   valid_letters_json, pangrams_json, answers_json, display_date,
                   status, source_json, fetched_at, updated_at
            FROM daily_spellingbee
            WHERE puzzle_date = ?
            """,
            (puzzle_date.isoformat(),),
        ).fetchone()
    return serialize_spellingbee(row) if row else None


def save_spellingbee_puzzle(
    *,
    puzzle_date: date,
    external_id: str,
    editor: str,
    center_letter: str,
    outer_letters: list[str],
    valid_letters: list[str],
    pangrams: list[str],
    answers: list[str],
    display_date: str,
    status: str,
    source: dict[str, Any],
) -> dict[str, Any]:
    now = datetime.now().astimezone().isoformat()
    with connect_spellingbee() as connection:
        connection.execute(
            """
            INSERT INTO daily_spellingbee (
              puzzle_date, external_id, editor, center_letter, outer_letters_json,
              valid_letters_json, pangrams_json, answers_json, display_date,
              status, source_json, fetched_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(puzzle_date) DO UPDATE SET
              external_id = excluded.external_id,
              editor = excluded.editor,
              center_letter = excluded.center_letter,
              outer_letters_json = excluded.outer_letters_json,
              valid_letters_json = excluded.valid_letters_json,
              pangrams_json = excluded.pangrams_json,
              answers_json = excluded.answers_json,
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
                center_letter,
                json.dumps(outer_letters, separators=(",", ":")),
                json.dumps(valid_letters, separators=(",", ":")),
                json.dumps(pangrams, separators=(",", ":")),
                json.dumps(answers, separators=(",", ":")),
                display_date,
                status,
                json.dumps(source, separators=(",", ":")),
                now,
                now,
            ),
        )

    cached = get_cached_spellingbee(puzzle_date)
    if cached is None:
        raise RuntimeError("Unable to cache Spelling Bee puzzle")
    return cached


def update_spellingbee_cache_timestamp(puzzle_date: date) -> None:
    now = datetime.now().astimezone().isoformat()
    with connect_spellingbee() as connection:
        connection.execute(
            """
            UPDATE daily_spellingbee
            SET fetched_at = ?, updated_at = ?
            WHERE puzzle_date = ?
            """,
            (now, now, puzzle_date.isoformat()),
        )


def serialize_spellingbee(row) -> dict[str, Any]:
    return {
        "date": row["puzzle_date"],
        "externalId": row["external_id"],
        "editor": row["editor"],
        "centerLetter": row["center_letter"],
        "outerLetters": json.loads(row["outer_letters_json"]),
        "validLetters": json.loads(row["valid_letters_json"]),
        "pangrams": json.loads(row["pangrams_json"]),
        "answers": json.loads(row["answers_json"]),
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
        "center_letter": fetched["center_letter"],
        "outer_letters": fetched["outer_letters"],
        "valid_letters": fetched["valid_letters"],
        "pangrams": fetched["pangrams"],
        "answers": fetched["answers"],
        "display_date": fetched["display_date"],
        "source": fetched["source"],
    }
