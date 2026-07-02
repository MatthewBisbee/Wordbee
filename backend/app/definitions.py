from __future__ import annotations

import json
from datetime import datetime
from typing import Any

import requests

from .db import connect


DEFINITION_TIMEOUT_SECONDS = 8
DEFINITION_USER_AGENT = "Wordbee/0.1 (+https://github.com/MatthewBisbee/Wordbee)"
FREE_DICTIONARY_URL = "https://api.dictionaryapi.dev/api/v2/entries/en"
DATAMUSE_URL = "https://api.datamuse.com/words"
PART_OF_SPEECH_LABELS = {
    "adj": "adjective",
    "adv": "adverb",
    "n": "noun",
    "v": "verb",
}


def get_definition(word: str) -> dict[str, Any]:
    normalized_word = word.strip().upper()
    cached_definition = get_cached_definition(normalized_word)

    if cached_definition is not None and definition_is_complete(cached_definition):
        return cached_definition

    fetched_definition = fetch_definition(normalized_word)

    if fetched_definition is None:
        if cached_definition is not None:
            return save_definition(complete_definition(cached_definition))

        return complete_definition(
            {
                "word": normalized_word,
                "phonetic": "",
                "partOfSpeech": "",
                "definition": "",
                "example": "",
                "synonyms": [],
                "sourceUrl": "",
            }
        )

    if cached_definition is not None:
        fetched_definition = merge_definition_records(cached_definition, fetched_definition)

    return save_definition(complete_definition(fetched_definition))


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


def definition_is_complete(definition_record: dict[str, Any]) -> bool:
    return all(
        [
            normalize_string(definition_record.get("phonetic")),
            normalize_string(definition_record.get("definition")),
            normalize_string(definition_record.get("example")),
            isinstance(definition_record.get("synonyms"), list)
            and len(definition_record["synonyms"]) > 0,
        ]
    )


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
    dictionary_record = fetch_free_dictionary_definition(word)
    datamuse_record = fetch_datamuse_definition(word)

    if dictionary_record is None and datamuse_record is None:
        return None

    return merge_definition_records(
        dictionary_record or empty_definition_record(word),
        datamuse_record or empty_definition_record(word),
    )


def fetch_free_dictionary_definition(word: str) -> dict[str, Any] | None:
    try:
        response = requests.get(
            f"{FREE_DICTIONARY_URL}/{word.lower()}",
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

    if not isinstance(selected_meaning, dict) or not isinstance(selected_definition, dict):
        return None

    definition_text = normalize_string(selected_definition.get("definition"))
    if not definition_text:
        return None

    source_urls = entry.get("sourceUrls")

    return {
        "word": word,
        "phonetic": normalize_phonetic(entry.get("phonetic")),
        "partOfSpeech": normalize_string(selected_meaning.get("partOfSpeech")),
        "definition": shorten_definition(definition_text),
        "example": normalize_string(selected_definition.get("example")),
        "synonyms": collect_synonyms(selected_meaning, selected_definition),
        "sourceUrl": source_urls[0] if isinstance(source_urls, list) and source_urls else "",
    }


def fetch_datamuse_definition(word: str) -> dict[str, Any] | None:
    metadata = fetch_datamuse_metadata(word)
    synonyms = fetch_datamuse_synonyms(word)

    if metadata is None and not synonyms:
        return None

    record = metadata or empty_definition_record(word)
    record["synonyms"] = merge_synonym_lists(record.get("synonyms", []), synonyms)

    return record


def fetch_datamuse_metadata(word: str) -> dict[str, Any] | None:
    try:
        response = requests.get(
            DATAMUSE_URL,
            params={"sp": word.lower(), "qe": "sp", "md": "dpr", "ipa": "1", "max": "1"},
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
    if not isinstance(entry, dict) or entry.get("word", "").casefold() != word.casefold():
        return None

    tags = entry.get("tags") if isinstance(entry.get("tags"), list) else []
    definitions = entry.get("defs") if isinstance(entry.get("defs"), list) else []

    return {
        "word": word,
        "phonetic": parse_datamuse_pronunciation(tags),
        "partOfSpeech": parse_datamuse_part_of_speech(tags, definitions),
        "definition": parse_datamuse_definition(definitions),
        "example": "",
        "synonyms": [],
        "sourceUrl": "https://www.datamuse.com/api/",
    }


def fetch_datamuse_synonyms(word: str) -> list[str]:
    try:
        response = requests.get(
            DATAMUSE_URL,
            params={"rel_syn": word.lower(), "max": "4"},
            headers={"User-Agent": DEFINITION_USER_AGENT, "Accept": "application/json"},
            timeout=DEFINITION_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception:
        return []

    if not isinstance(payload, list):
        return []

    synonyms = []
    for entry in payload:
        synonym = entry.get("word") if isinstance(entry, dict) else None
        if isinstance(synonym, str) and synonym.isalpha():
            synonyms.append(synonym)

    return synonyms


def complete_definition(definition_record: dict[str, Any]) -> dict[str, Any]:
    completed_record = {
        "word": definition_record["word"],
        "phonetic": normalize_phonetic(definition_record.get("phonetic")),
        "partOfSpeech": normalize_string(definition_record.get("partOfSpeech")),
        "definition": shorten_definition(normalize_string(definition_record.get("definition"))),
        "example": normalize_string(definition_record.get("example")),
        "synonyms": merge_synonym_lists(definition_record.get("synonyms", []), []),
        "sourceUrl": normalize_string(definition_record.get("sourceUrl")),
    }

    if not completed_record["definition"]:
        completed_record["definition"] = "No short definition is available yet."

    if not completed_record["example"]:
        completed_record["example"] = create_usage_sentence(
            completed_record["word"],
            completed_record["partOfSpeech"],
        )

    return completed_record


def merge_definition_records(
    primary_record: dict[str, Any],
    secondary_record: dict[str, Any],
) -> dict[str, Any]:
    return {
        "word": primary_record.get("word") or secondary_record.get("word"),
        "phonetic": primary_record.get("phonetic") or secondary_record.get("phonetic") or "",
        "partOfSpeech": primary_record.get("partOfSpeech")
        or secondary_record.get("partOfSpeech")
        or "",
        "definition": primary_record.get("definition") or secondary_record.get("definition") or "",
        "example": primary_record.get("example") or secondary_record.get("example") or "",
        "synonyms": merge_synonym_lists(
            primary_record.get("synonyms", []),
            secondary_record.get("synonyms", []),
        ),
        "sourceUrl": primary_record.get("sourceUrl") or secondary_record.get("sourceUrl") or "",
    }


def empty_definition_record(word: str) -> dict[str, Any]:
    return {
        "word": word,
        "phonetic": "",
        "partOfSpeech": "",
        "definition": "",
        "example": "",
        "synonyms": [],
        "sourceUrl": "",
    }


def collect_synonyms(meaning: dict[str, Any], definition: dict[str, Any]) -> list[str]:
    synonyms: list[str] = []

    for source in (definition.get("synonyms"), meaning.get("synonyms")):
        if not isinstance(source, list):
            continue

        synonyms = merge_synonym_lists(synonyms, source)

    return synonyms


def merge_synonym_lists(primary_synonyms: object, secondary_synonyms: object) -> list[str]:
    synonyms: list[str] = []

    for source in (primary_synonyms, secondary_synonyms):
        if not isinstance(source, list):
            continue

        for synonym in source:
            normalized_synonym = normalize_string(synonym).lower()
            if (
                normalized_synonym
                and normalized_synonym.isalpha()
                and normalized_synonym not in synonyms
            ):
                synonyms.append(normalized_synonym)

    return synonyms[:4]


def parse_datamuse_pronunciation(tags: list[object]) -> str:
    for tag in tags:
        if not isinstance(tag, str) or not tag.startswith("ipa_pron:"):
            continue

        pronunciation = tag.removeprefix("ipa_pron:").strip()
        if pronunciation:
            return f"/{pronunciation}/"

    return ""


def parse_datamuse_part_of_speech(tags: list[object], definitions: list[object]) -> str:
    for tag in tags:
        if isinstance(tag, str) and tag in PART_OF_SPEECH_LABELS:
            return PART_OF_SPEECH_LABELS[tag]

    for definition in definitions:
        if not isinstance(definition, str) or "\t" not in definition:
            continue

        part_of_speech, _definition_text = definition.split("\t", 1)
        return PART_OF_SPEECH_LABELS.get(part_of_speech, part_of_speech)

    return ""


def parse_datamuse_definition(definitions: list[object]) -> str:
    for raw_definition in definitions:
        if not isinstance(raw_definition, str):
            continue

        definition_text = raw_definition.split("\t", 1)[-1]
        definition_text = normalize_string(definition_text)

        if definition_text:
            return shorten_definition(definition_text)

    return ""


def shorten_definition(definition_text: str) -> str:
    if not definition_text:
        return ""

    first_sentence = definition_text.split("; also,")[0].split(". ")[0].strip()
    if first_sentence and not first_sentence.endswith("."):
        first_sentence = f"{first_sentence}."

    if len(first_sentence) <= 160:
        return first_sentence

    return f"{first_sentence[:157].rstrip()}..."


def create_usage_sentence(word: str, part_of_speech: str) -> str:
    lower_word = word.lower()
    normalized_part = part_of_speech.casefold()

    if normalized_part == "verb":
        return f"They chose to {lower_word} before the day was over."

    if normalized_part == "adjective":
        return f"The final clue felt {lower_word} once the answer clicked."

    if normalized_part == "adverb":
        return f"She answered {lower_word} after reading the clue."

    return f"The {lower_word} offered expert guidance during the project."


def normalize_phonetic(value: object) -> str:
    phonetic = normalize_string(value)

    if not phonetic:
        return ""

    if phonetic.startswith("/") and phonetic.endswith("/"):
        return phonetic

    return f"/{phonetic.strip('/')}/"


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
