from __future__ import annotations

import json
import os
import re
from collections import Counter
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

import requests

from .db import connect


ANSWER_LENGTH = 5
CACHE_TTL_SECONDS = 60 * 60 * 18
SOURCE_TIMEOUT_SECONDS = 8
DEV_FALLBACK_ANSWER = "MAVEN"
FIRST_OFFICIAL_PUZZLE_DATE = date(2021, 6, 19)
PUBLISHER_BASE_URL = "https://www.nytimes.com/svc/" + "wor" + "dle" + "/v2"
USER_AGENT = "Wordbee/0.1 (+https://github.com/MatthewBisbee/Wordbee)"
TRUTHY_VALUES = {"1", "true", "yes", "on"}
DEFAULT_PUZZLE_TIMEZONE = "America/Chicago"
LEGACY_EARLY_ROLLOVER_TIMEZONE = "America/New_York"


def get_puzzle_date(raw_date: object = None, *, now: datetime | None = None) -> date:
    if raw_date:
        if not isinstance(raw_date, str):
            raise ValueError("Invalid date")

        try:
            return date.fromisoformat(raw_date)
        except ValueError as exc:
            raise ValueError("Invalid date") from exc

    timezone_name = get_puzzle_timezone_name()
    timezone = ZoneInfo(timezone_name)
    current_time = now or datetime.now(timezone)

    if current_time.tzinfo is None:
        current_time = current_time.replace(tzinfo=timezone)

    return current_time.astimezone(timezone).date()


def get_puzzle_timezone_name() -> str:
    timezone_name = os.environ.get("WORDBEE_PUZZLE_TIMEZONE", DEFAULT_PUZZLE_TIMEZONE)
    if timezone_name == LEGACY_EARLY_ROLLOVER_TIMEZONE:
        return DEFAULT_PUZZLE_TIMEZONE

    return timezone_name


def get_daily_answer(puzzle_date: date, force_refresh: bool = False) -> dict[str, Any]:
    validate_supported_puzzle_date(puzzle_date)

    if not force_refresh:
        cached_answer = get_cached_answer(puzzle_date)
        if cached_answer is not None:
            return cached_answer

    source_results = fetch_sources(puzzle_date)
    answer, confidence, status = choose_answer(source_results)

    if answer is None:
        if is_dev_fallback_enabled() and puzzle_date == get_puzzle_date():
            source_results.append(
                {
                    "id": "dev-fallback",
                    "ok": True,
                    "answer": DEV_FALLBACK_ANSWER,
                    "note": "Local development fallback",
                }
            )
            return create_answer_record(
                puzzle_date=puzzle_date,
                answer=DEV_FALLBACK_ANSWER,
                confidence=0.0,
                status="dev-fallback",
                source_results=source_results,
            )

        raise RuntimeError("Unable to load the Wordbee answer for this date")

    return save_answer(
        puzzle_date=puzzle_date,
        answer=answer,
        confidence=confidence,
        status=status,
        source_results=source_results,
    )


def validate_supported_puzzle_date(puzzle_date: date) -> None:
    if puzzle_date < FIRST_OFFICIAL_PUZZLE_DATE:
        raise ValueError("Choose a date on or after 2021-06-19")


def get_cached_answer(puzzle_date: date) -> dict[str, Any] | None:
    with connect() as connection:
        row = connection.execute(
            """
            SELECT puzzle_date, answer, answer_length, confidence, status,
                   source_count, sources_json, fetched_at, updated_at
            FROM daily_answers
            WHERE puzzle_date = ?
            """,
            (puzzle_date.isoformat(),),
        ).fetchone()

    if row is None:
        return None

    if row["status"] == "dev-fallback":
        return None

    fetched_at = datetime.fromisoformat(row["fetched_at"])
    age_seconds = (datetime.now().astimezone() - fetched_at).total_seconds()
    if age_seconds > CACHE_TTL_SECONDS and row["status"] != "confirmed":
        return None

    return row_to_answer(row)


def create_answer_record(
    *,
    puzzle_date: date,
    answer: str,
    confidence: float,
    status: str,
    source_results: list[dict[str, Any]],
) -> dict[str, Any]:
    now = datetime.now().astimezone().isoformat()

    return {
        "puzzle_date": puzzle_date.isoformat(),
        "answer": answer,
        "answer_length": ANSWER_LENGTH,
        "confidence": confidence,
        "status": status,
        "source_count": len(source_results),
        "sources": source_results,
        "fetched_at": now,
        "updated_at": now,
    }


def save_answer(
    *,
    puzzle_date: date,
    answer: str,
    confidence: float,
    status: str,
    source_results: list[dict[str, Any]],
) -> dict[str, Any]:
    now = datetime.now().astimezone().isoformat()
    normalized_sources = json.dumps(source_results, separators=(",", ":"))

    with connect() as connection:
        connection.execute(
            """
            INSERT INTO daily_answers (
              puzzle_date, answer, answer_length, confidence, status,
              source_count, sources_json, fetched_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(puzzle_date) DO UPDATE SET
              answer = excluded.answer,
              answer_length = excluded.answer_length,
              confidence = excluded.confidence,
              status = excluded.status,
              source_count = excluded.source_count,
              sources_json = excluded.sources_json,
              fetched_at = excluded.fetched_at,
              updated_at = excluded.updated_at
            """,
            (
                puzzle_date.isoformat(),
                answer,
                ANSWER_LENGTH,
                confidence,
                status,
                len(source_results),
                normalized_sources,
                now,
                now,
            ),
        )

    cached_answer = get_cached_answer(puzzle_date)
    if cached_answer is None:
        raise RuntimeError("Unable to cache today's Wordbee answer")

    return cached_answer


def fetch_sources(puzzle_date: date) -> list[dict[str, Any]]:
    sources = [fetch_publisher_source(puzzle_date)]

    if os.environ.get("WORDBEE_ENABLE_ARTICLE_CORROBORATORS", "0") == "1":
        sources.extend(fetch_article_sources(puzzle_date))

    return sources


def fetch_publisher_source(puzzle_date: date) -> dict[str, Any]:
    url = f"{PUBLISHER_BASE_URL}/{puzzle_date.isoformat()}.json"

    try:
        response = requests.get(
            url,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            timeout=SOURCE_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        return {
            "id": "publisher",
            "ok": False,
            "error": str(exc),
        }

    answer = normalize_answer(payload.get("solution"))
    payload_date = payload.get("print_date")

    if payload_date != puzzle_date.isoformat():
        return {
            "id": "publisher",
            "ok": False,
            "error": "Publisher date did not match requested date",
            "date": payload_date,
        }

    if answer is None:
        return {
            "id": "publisher",
            "ok": False,
            "error": "Publisher answer was missing or invalid",
            "date": payload_date,
        }

    return {
        "id": "publisher",
        "ok": True,
        "answer": answer,
        "date": payload_date,
        "externalId": payload.get("id"),
        "daysSinceLaunch": payload.get("days_since_launch"),
    }


def fetch_article_sources(puzzle_date: date) -> list[dict[str, Any]]:
    configured_sources = [
        ("article-tech", "https://www.techradar.com/news/" + "wor" + "dle" + "-today"),
        (
            "article-guide",
            "https://www.tomsguide.com/news/what-is-todays-" + "wor" + "dle" + "-answer",
        ),
    ]

    return [fetch_article_source(source_id, url, puzzle_date) for source_id, url in configured_sources]


def fetch_article_source(source_id: str, url: str, puzzle_date: date) -> dict[str, Any]:
    try:
        response = requests.get(
            url,
            headers={"User-Agent": USER_AGENT, "Accept": "text/html"},
            timeout=SOURCE_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except Exception as exc:
        return {
            "id": source_id,
            "ok": False,
            "error": str(exc),
        }

    answer = extract_answer_from_article(response.text)
    if answer is None:
        return {
            "id": source_id,
            "ok": False,
            "error": "No answer found in article response",
        }

    return {
        "id": source_id,
        "ok": True,
        "answer": answer,
        "date": puzzle_date.isoformat(),
    }


def extract_answer_from_article(raw_html: str) -> str | None:
    text = re.sub(r"<[^>]+>", " ", raw_html)
    text = re.sub(r"\s+", " ", text)

    patterns = [
        r"answer[^A-Za-z]{1,80}(?:is|was)[^A-Za-z]{1,20}([A-Za-z]{5})",
        r"solution[^A-Za-z]{1,80}(?:is|was)[^A-Za-z]{1,20}([A-Za-z]{5})",
        r"today[^A-Za-z]{1,40}answer[^A-Za-z]{1,80}([A-Za-z]{5})",
    ]

    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if not match:
            continue

        answer = normalize_answer(match.group(1))
        if answer is not None:
            return answer

    return None


def choose_answer(source_results: list[dict[str, Any]]) -> tuple[str | None, float, str]:
    answers = [
        source["answer"]
        for source in source_results
        if source.get("ok") and normalize_answer(source.get("answer")) is not None
    ]

    if not answers:
        return None, 0.0, "unavailable"

    answer_counts = Counter(answers)
    selected_answer, _selected_count = answer_counts.most_common(1)[0]
    successful_sources = len(answers)
    conflicting_answers = len(answer_counts) > 1

    if conflicting_answers:
        return selected_answer, 0.35, "conflict"

    if successful_sources >= 2:
        return selected_answer, 0.99, "confirmed"

    publisher_result = next(
        (source for source in source_results if source.get("id") == "publisher"),
        None,
    )
    if publisher_result and publisher_result.get("ok"):
        return selected_answer, 0.92, "publisher"

    return selected_answer, 0.7, "single-source"


def normalize_answer(raw_answer: object) -> str | None:
    if not isinstance(raw_answer, str):
        return None

    answer = raw_answer.strip().upper()
    if len(answer) != ANSWER_LENGTH or not answer.isalpha():
        return None

    return answer


def is_dev_fallback_enabled() -> bool:
    configured_value = os.environ.get("WORDBEE_ENABLE_DEV_FALLBACK")

    if configured_value is not None:
        return configured_value.strip().casefold() in TRUTHY_VALUES

    return os.environ.get("FLASK_ENV", "").strip().casefold() == "development"


def row_to_answer(row: Any) -> dict[str, Any]:
    return {
        "puzzle_date": row["puzzle_date"],
        "answer": row["answer"],
        "answer_length": row["answer_length"],
        "confidence": row["confidence"],
        "status": row["status"],
        "source_count": row["source_count"],
        "sources": json.loads(row["sources_json"]),
        "fetched_at": row["fetched_at"],
        "updated_at": row["updated_at"],
    }
