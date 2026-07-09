from __future__ import annotations

import json
import random
from datetime import date, datetime
from typing import Any

from ..db import connect_game
from .common import PUBLISHER_BASE_URL, fetch_json, normalize_text


CONNECTIONS_GROUPS = 4


CONNECTIONS_CARDS_PER_GROUP = 4


CONNECTIONS_MISTAKES_ALLOWED = 4


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


def get_connections_puzzle(
    puzzle_date: date,
    *,
    force_refresh: bool = False,
) -> dict[str, Any]:
    if not force_refresh:
        cached = get_cached_connections(puzzle_date)
        if cached is not None:
            if cached["status"] == "confirmed":
                return cached
            fetched_at = datetime.fromisoformat(cached["fetched_at"])
            age_seconds = (datetime.now().astimezone() - fetched_at).total_seconds()
            if age_seconds <= 60 * 30:
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

    cached_generated = get_cached_connections(puzzle_date)
    if cached_generated is not None:
        update_connections_cache_timestamp(puzzle_date)
        return cached_generated

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


def warm_connections_puzzle(puzzle_date: date) -> dict[str, Any]:
    cached = get_cached_connections(puzzle_date)
    if cached is not None and cached["status"] == "confirmed":
        return {"confirmed": True, "status": "cached", "fetchedAt": cached["fetched_at"]}

    fetched = fetch_connections_source(puzzle_date)
    if not fetched["ok"]:
        return {"confirmed": False, "status": "failed", "source": fetched["source"]}

    saved = save_connections_puzzle(
        puzzle_date=puzzle_date,
        external_id=str(fetched["payload"].get("id") or ""),
        editor=normalize_text(fetched["payload"].get("editor"), max_length=80),
        cards=fetched["cards"],
        groups=fetched["groups"],
        status="confirmed",
        source=fetched["source"],
    )
    return {"confirmed": True, "status": "fetched", "fetchedAt": saved["fetched_at"]}


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


def get_cached_connections(puzzle_date: date) -> dict[str, Any] | None:
    with connect_game("connections") as connection:
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
    with connect_game("connections") as connection:
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


def update_connections_cache_timestamp(puzzle_date: date) -> None:
    now = datetime.now().astimezone().isoformat()
    with connect_game("connections") as connection:
        connection.execute(
            """
            UPDATE daily_connections
            SET fetched_at = ?, updated_at = ?
            WHERE puzzle_date = ?
            """,
            (now, now, puzzle_date.isoformat()),
        )


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


def serialize_connections(row) -> dict[str, Any]:
    return {
        "cards": json.loads(row["cards_json"]),
        "date": row["puzzle_date"],
        "editor": row["editor"],
        "externalId": row["external_id"],
        "groups": json.loads(row["groups_json"]),
        "source": json.loads(row["source_json"]),
        "status": row["status"],
        "fetched_at": row["fetched_at"],
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
