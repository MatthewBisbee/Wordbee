from __future__ import annotations

import json
from datetime import datetime
from typing import Any

import requests

from .db import connect


DEFINITION_TIMEOUT_SECONDS = 8
DEFINITION_USER_AGENT = "Wordbee/0.1 (+https://github.com/MatthewBisbee/Wordbee)"


def get_definition(word: str) -> dict[str, Any]:
    normalized_word = word.strip().upper()
    cached_definition = get_cached_definition(normalized_word)

    if cached_definition is not None:
        return cached_definition

    fetched_definition = fetch_definition(normalized_word)
    if fetched_definition is None:
        return {
            "word": normalized_word,
            "phonetic": "",
            "partOfSpeech": "",
            "definition": "No definition available yet.",
            "example": "",
            "synonyms": [],
            "sourceUrl": "",
        }

    return save_definition(fetched_definition)


def get_cached_definition(word: str) -> dict[str, Any] | None:
    with connect() as connection:
        row = connection.execute(
            """
            SELECT word, phonetic, part_of_speech, definition, example,
                   synonyms_json, source_url, fetched_at, updated_at
            FROM word_definitions
            WHERE word = ?
            """,
            (word,),
        ).fetchone()

    if row is None:
        return None

    return row_to_definition(row)


def save_definition(definition_record: dict[str, Any]) -> dict[str, Any]:
    now = datetime.now().astimezone().isoformat()

    with connect() as connection:
        connection.execute(
            """
            INSERT INTO word_definitions (
              word, phonetic, part_of_speech, definition, example,
              synonyms_json, source_url, fetched_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(word) DO UPDATE SET
              phonetic = excluded.phonetic,
              part_of_speech = excluded.part_of_speech,
              definition = excluded.definition,
              example = excluded.example,
              synonyms_json = excluded.synonyms_json,
              source_url = excluded.source_url,
              updated_at = excluded.updated_at
            """,
            (
                definition_record["word"],
                definition_record.get("phonetic", ""),
                definition_record.get("partOfSpeech", ""),
                definition_record["definition"],
                definition_record.get("example", ""),
                json.dumps(definition_record.get("synonyms", []), separators=(",", ":")),
                definition_record.get("sourceUrl", ""),
                now,
                now,
            ),
        )

    cached_definition = get_cached_definition(definition_record["word"])
    if cached_definition is None:
        raise RuntimeError("Unable to cache definition")

    return cached_definition


def fetch_definition(word: str) -> dict[str, Any] | None:
    try:
        response = requests.get(
            f"https://api.dictionaryapi.dev/api/v2/entries/en/{word.lower()}",
            headers={"User-Agent": DEFINITION_USER_AGENT, "Accept": "application/json"},
            timeout=DEFINITION_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception:
        return None

    if not isinstance(payload, list) or not payload:
        return None

    entry = payload[0]
    meanings = entry.get("meanings") if isinstance(entry, dict) else None
    if not isinstance(meanings, list):
        return None

    selected_meaning = None
    selected_definition = None

    for meaning in meanings:
        definitions = meaning.get("definitions") if isinstance(meaning, dict) else None
        if isinstance(definitions, list) and definitions:
            selected_meaning = meaning
            selected_definition = definitions[0]
            break

    if not isinstance(selected_definition, dict):
        return None

    definition_text = selected_definition.get("definition")
    if not isinstance(definition_text, str) or not definition_text.strip():
        return None

    synonyms = collect_synonyms(selected_meaning, selected_definition)
    source_urls = entry.get("sourceUrls")

    return {
        "word": word,
        "phonetic": normalize_string(entry.get("phonetic")),
        "partOfSpeech": normalize_string(selected_meaning.get("partOfSpeech")),
        "definition": definition_text.strip(),
        "example": normalize_string(selected_definition.get("example")),
        "synonyms": synonyms,
        "sourceUrl": source_urls[0] if isinstance(source_urls, list) and source_urls else "",
    }


def collect_synonyms(meaning: dict[str, Any], definition: dict[str, Any]) -> list[str]:
    synonyms: list[str] = []

    for source in (definition.get("synonyms"), meaning.get("synonyms")):
        if not isinstance(source, list):
            continue

        for synonym in source:
            if isinstance(synonym, str) and synonym.strip():
                normalized_synonym = synonym.strip()
                if normalized_synonym not in synonyms:
                    synonyms.append(normalized_synonym)

    return synonyms[:4]


def normalize_string(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def row_to_definition(row: Any) -> dict[str, Any]:
    return {
        "word": row["word"],
        "phonetic": row["phonetic"] or "",
        "partOfSpeech": row["part_of_speech"] or "",
        "definition": row["definition"],
        "example": row["example"] or "",
        "synonyms": json.loads(row["synonyms_json"]),
        "sourceUrl": row["source_url"] or "",
    }
