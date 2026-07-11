from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from ..auth import decode_avatar_json
from ..daily_answer import get_puzzle_date
from ..db import connect
from .registry import GAME_KEYS, get_game_first_date


MAX_GAME_HISTORY_RESULTS = 40


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

    if game_key in {"connections", "letterboxed", "tiles"}:
        elapsed_seconds = None

    if identity is None:
        return {"created": False, "result": None}

    user_id = identity.get("userId")
    if not user_id:
        raise ValueError("Friends and family sign-in required")

    result_id = f"{user_id}:{game_key}:{puzzle_date}:{puzzle_variant or 'daily'}"
    now = datetime.now().astimezone().isoformat()
    normalized_score = json.dumps(score, separators=(",", ":"), sort_keys=True)
    # A completion counts as a live daily only when its date is today's puzzle.
    play_type = "daily" if puzzle_date == get_puzzle_date().isoformat() else "retro"

    with connect() as connection:
        cursor = connection.execute(
            """
            INSERT OR IGNORE INTO friends_family_game_results (
              id, user_id, game_key, puzzle_date, puzzle_variant, outcome,
              elapsed_seconds, score_json, play_type, completed_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                play_type,
                now,
            ),
        )
        created = cursor.rowcount == 1
        if created:
            connection.execute(
                """
                DELETE FROM friends_family_game_attempts
                WHERE user_id = ? AND game_key = ? AND puzzle_date = ? AND puzzle_variant = ?
                """,
                (user_id, game_key, puzzle_date, puzzle_variant or "daily"),
            )

    return {
        "created": created,
        "result": get_multigame_result_for_user(
            user_id=user_id,
            game_key=game_key,
            puzzle_date=puzzle_date,
            puzzle_variant=puzzle_variant or "daily",
        ),
    }


def upsert_spellingbee_result(
    *,
    user_id: str,
    puzzle_date: str,
    puzzle_variant: str,
    score: dict[str, Any],
) -> dict[str, Any] | None:
    """Create or merge a Spelling Bee day's result.

    Spelling Bee has no discrete "completion" — the found-word set grows across a
    session and across a user's devices. So unlike every other game (whose result
    is written once and frozen), this row is updated in place with the merged
    aggregate. The union itself is done by the caller (which has the puzzle); here
    we only persist it, preserving the original ``play_type``/``completed_at`` so a
    day first opened live stays counted as a daily play. ``outcome`` is always
    ``won`` — it means "played" (there is no fail state), and Spelling Bee stats
    read the rank/score rather than a win flag.
    """
    result_id = f"{user_id}:spellingbee:{puzzle_date}:{puzzle_variant or 'daily'}"
    now = datetime.now().astimezone().isoformat()
    normalized_score = json.dumps(score, separators=(",", ":"), sort_keys=True)
    play_type = "daily" if puzzle_date == get_puzzle_date().isoformat() else "retro"

    with connect() as connection:
        connection.execute(
            """
            INSERT INTO friends_family_game_results (
              id, user_id, game_key, puzzle_date, puzzle_variant, outcome,
              elapsed_seconds, score_json, play_type, completed_at
            )
            VALUES (?, ?, 'spellingbee', ?, ?, 'won', NULL, ?, ?, ?)
            ON CONFLICT(user_id, game_key, puzzle_date, puzzle_variant) DO UPDATE SET
              score_json = excluded.score_json
            """,
            (
                result_id,
                user_id,
                puzzle_date,
                puzzle_variant or "daily",
                normalized_score,
                play_type,
                now,
            ),
        )

    return get_multigame_result_for_user(
        user_id=user_id,
        game_key="spellingbee",
        puzzle_date=puzzle_date,
        puzzle_variant=puzzle_variant or "daily",
    )


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
    
    # Process locking
    today_str = get_puzzle_date().isoformat()
    completed_combos = {
        (r["gameKey"], r["date"], r["variant"])
        for r in results
        if r["userId"] == requesting_user_id
    }
    
    for result in results:
        if result["date"] == today_str and result["userId"] != requesting_user_id:
            combo = (result["gameKey"], result["date"], result["variant"])
            if combo not in completed_combos:
                result["locked"] = True
                result["outcome"] = "locked"
                result["elapsedSeconds"] = None
                result["score"] = {}
            else:
                result["locked"] = False
        else:
            result["locked"] = False

    dashboard = empty_multigame_dashboard()
    for game_key in GAME_KEYS:
        game_results = [result for result in results if result["gameKey"] == game_key]
        dashboard[game_key] = {
            "groupStats": calculate_multigame_stats(game_results, game_key),
            "users": [
                {
                    **user,
                    "stats": calculate_multigame_stats(
                        [result for result in game_results if result["userId"] == user["id"]],
                        game_key
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


def get_multigame_calendar(
    *,
    requesting_user_id: str,
    target_user_id: str,
    game_key: str,
    current_puzzle_date: str,
) -> dict[str, Any]:
    """Every recorded play (daily and retro) of one game for one user.

    Sudoku has difficulty variants, so days are collapsed to their best result
    (a daily win outranks a retro win, which outranks a daily loss, then a retro
    loss); the click-through detail carries that representative play.
    """
    if game_key not in GAME_KEYS:
        raise ValueError("Invalid game")

    first_date = get_game_first_date(game_key).isoformat()
    with connect() as connection:
        requester = connection.execute(
            "SELECT code_id FROM friends_family_users WHERE id = ?",
            (requesting_user_id,),
        ).fetchone()
        target = connection.execute(
            "SELECT id, code_id, display_name FROM friends_family_users WHERE id = ?",
            (target_user_id,),
        ).fetchone()
        if requester is None or target is None or requester["code_id"] != target["code_id"]:
            return {
                "gameKey": game_key,
                "userId": target_user_id,
                "displayName": "",
                "firstDate": first_date,
                "currentDate": current_puzzle_date,
                "canRevealCurrentDay": True,
                "entries": [],
            }

        result_rows = connection.execute(
            """
            SELECT results.*, users.display_name, users.avatar_json
            FROM friends_family_game_results AS results
            JOIN friends_family_users AS users ON users.id = results.user_id
            WHERE results.user_id = ? AND results.game_key = ?
            ORDER BY results.puzzle_date ASC
            """,
            (target_user_id, game_key),
        ).fetchall()
        requester_today = connection.execute(
            """
            SELECT id FROM friends_family_game_results
            WHERE user_id = ? AND game_key = ? AND puzzle_date = ?
            """,
            (requesting_user_id, game_key, current_puzzle_date),
        ).fetchone()

    can_reveal_today = requesting_user_id == target_user_id or requester_today is not None

    best_by_date: dict[str, tuple[tuple[int, int], dict[str, Any]]] = {}
    for row in result_rows:
        result = serialize_multigame_result(row)
        rank = (
            0 if result["playType"] == "daily" else 1,
            0 if result["outcome"] == "won" else 1,
        )
        existing = best_by_date.get(result["date"])
        if existing is None or rank < existing[0]:
            best_by_date[result["date"]] = (rank, result)

    entries = []
    for date in sorted(best_by_date):
        result = best_by_date[date][1]
        locked = date == current_puzzle_date and not can_reveal_today
        entry: dict[str, Any] = {
            "date": date,
            "playType": result["playType"],
            "outcome": "locked" if locked else result["outcome"],
        }
        if not locked:
            entry["detail"] = {
                "variant": result["variant"],
                "elapsedSeconds": result["elapsedSeconds"],
                "score": result["score"],
            }
        entries.append(entry)

    return {
        "gameKey": game_key,
        "userId": target_user_id,
        "displayName": target["display_name"],
        "firstDate": first_date,
        "currentDate": current_puzzle_date,
        "canRevealCurrentDay": can_reveal_today,
        "entries": entries,
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
    game_key = row["game_key"]
    elapsed_seconds = row["elapsed_seconds"]
    if game_key in {"connections", "strands", "letterboxed", "spellingbee", "tiles"}:
        elapsed_seconds = None

    result = {
        "completedAt": row["completed_at"],
        "date": row["puzzle_date"],
        "displayName": row["display_name"],
        "elapsedSeconds": elapsed_seconds,
        "gameKey": game_key,
        "id": row["id"],
        "outcome": row["outcome"],
        "playType": row["play_type"] if "play_type" in row.keys() else "daily",
        "score": json.loads(row["score_json"]),
        "userId": row["user_id"],
        "variant": row["puzzle_variant"],
    }
    avatar = decode_avatar_json(row["avatar_json"])
    if avatar is not None:
        result["avatar"] = avatar
    return result


def calculate_multigame_stats(results: list[dict[str, Any]], game_key: str = None) -> dict[str, Any]:
    # Only live daily completions count toward stats; retro/archive plays and
    # locked current-day rows are excluded.
    unlocked_results = [
        r
        for r in results
        if not r.get("locked") and r.get("playType", "daily") == "daily"
    ]
    played = len(unlocked_results)

    if game_key == "strands":
        return {
            "played": played,
        }

    if game_key in {"sudoku", "crossword", "mini", "midi", "pips"}:
        elapsed_values = [
            int(result["elapsedSeconds"])
            for result in unlocked_results
            if result.get("elapsedSeconds") is not None
        ]
        return {
            "averageSeconds": round(sum(elapsed_values) / len(elapsed_values)) if elapsed_values else 0,
            "played": played,
        }

    if game_key == "spellingbee":
        # Spelling Bee is open-ended (you accumulate words toward ranks; there is
        # no win/lose), so the metrics are rank/score based: how often a player
        # reaches Genius, their average share of the day's points, words, and
        # pangrams. Every recorded score already carries these derived fields.
        summaries = [result.get("score") or {} for result in unlocked_results]
        percents = [int(summary.get("percent") or 0) for summary in summaries]
        word_counts = [int(summary.get("wordCount") or 0) for summary in summaries]
        genius = sum(1 for summary in summaries if summary.get("reachedGenius"))
        return {
            "played": played,
            "geniusRate": round((genius / played) * 100) if played else 0,
            "geniusCount": genius,
            "averagePercent": round(sum(percents) / len(percents)) if percents else 0,
            "bestPercent": max(percents) if percents else 0,
            "averageWords": round(sum(word_counts) / len(word_counts), 1) if word_counts else 0,
            "pangramsFound": sum(int(summary.get("pangramsFound") or 0) for summary in summaries),
            "queenBeeCount": sum(1 for summary in summaries if summary.get("isQueenBee")),
            "percentTimeline": build_spellingbee_percent_timeline(unlocked_results),
        }

    if game_key == "tiles":
        # Tiles always clears (no fail state); the meaningful metric is the
        # longest combo — the best run of consecutive matches on the shared daily
        # board. Perfect solves (zero wrong moves) are tracked as a secondary.
        combos = [
            int((result.get("score") or {}).get("longestCombo") or 0)
            for result in unlocked_results
        ]
        combos = [combo for combo in combos if combo > 0]
        perfects = sum(
            1 for result in unlocked_results if (result.get("score") or {}).get("perfect")
        )
        return {
            "played": played,
            "averageLongestCombo": round(sum(combos) / len(combos), 1) if combos else 0,
            "bestLongestCombo": max(combos) if combos else 0,
            "perfectCount": perfects,
            "perfectRate": round((perfects / played) * 100) if played else 0,
            "comboTimeline": build_tiles_combo_timeline(unlocked_results),
        }

    if game_key == "letterboxed":
        # Letter Boxed has no failure state (you either solve it or don't finish),
        # so words-used is the meaningful metric rather than a solve rate.
        solved = [result for result in unlocked_results if result["outcome"] == "won"]
        word_counts = [
            int((result.get("score") or {}).get("wordCount") or 0) for result in solved
        ]
        word_counts = [count for count in word_counts if count > 0]
        return {
            "played": played,
            "solved": len(solved),
            "averageWords": round(sum(word_counts) / len(word_counts), 2) if word_counts else 0,
            "bestWords": min(word_counts) if word_counts else 0,
            "wordsTimeline": build_letterboxed_words_timeline(solved),
        }

    wins = sum(1 for result in unlocked_results if result["outcome"] == "won")
    elapsed_values = [
        int(result["elapsedSeconds"])
        for result in unlocked_results
        if result["outcome"] == "won" and result.get("elapsedSeconds") is not None
    ]
    return {
        "averageSeconds": round(sum(elapsed_values) / len(elapsed_values)) if elapsed_values else 0,
        "played": played,
        "solveRate": round((wins / played) * 100) if played else 0,
        "wins": wins,
    }


def build_spellingbee_percent_timeline(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Family-wide average puzzle-completion % per day (daily plays, ascending)."""
    by_date: dict[str, list[int]] = {}
    for result in results:
        summary = result.get("score") or {}
        by_date.setdefault(result["date"], []).append(int(summary.get("percent") or 0))

    return [
        {
            "date": day,
            "averagePercent": round(sum(percents) / len(percents)),
            "plays": len(percents),
        }
        for day, percents in sorted(by_date.items())
    ]


def build_tiles_combo_timeline(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Family-wide average longest combo per day (daily plays only, ascending)."""
    by_date: dict[str, list[int]] = {}
    for result in results:
        combo = int((result.get("score") or {}).get("longestCombo") or 0)
        if combo <= 0:
            continue
        by_date.setdefault(result["date"], []).append(combo)

    return [
        {
            "date": day,
            "averageLongestCombo": round(sum(combos) / len(combos), 1),
            "plays": len(combos),
        }
        for day, combos in sorted(by_date.items())
    ]


def build_letterboxed_words_timeline(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Family-wide average words used per day (daily plays only, ascending date)."""
    by_date: dict[str, list[int]] = {}
    for result in results:
        word_count = int((result.get("score") or {}).get("wordCount") or 0)
        if word_count <= 0:
            continue
        by_date.setdefault(result["date"], []).append(word_count)

    return [
        {
            "date": day,
            "averageWords": round(sum(counts) / len(counts), 2),
            "plays": len(counts),
        }
        for day, counts in sorted(by_date.items())
    ]


def empty_multigame_dashboard() -> dict[str, Any]:
    return {
        game_key: {"groupStats": calculate_multigame_stats([], game_key), "users": []}
        for game_key in GAME_KEYS
    }


def get_multigame_attempt(
    *,
    user_id: str,
    game_key: str,
    puzzle_date: str,
    puzzle_variant: str,
) -> dict[str, Any] | None:
    with connect() as connection:
        row = connection.execute(
            """
            SELECT state_json, updated_at
            FROM friends_family_game_attempts
            WHERE user_id = ? AND game_key = ? AND puzzle_date = ? AND puzzle_variant = ?
            """,
            (user_id, game_key, puzzle_date, puzzle_variant),
        ).fetchone()
    if row:
        return {
            "state": json.loads(row["state_json"]),
            "updatedAt": row["updated_at"],
        }
    return None


def save_multigame_attempt(
    *,
    user_id: str,
    game_key: str,
    puzzle_date: str,
    puzzle_variant: str,
    state: dict[str, Any],
) -> None:
    now = datetime.now().astimezone().isoformat()
    state_json = json.dumps(state, separators=(",", ":"))
    with connect() as connection:
        connection.execute(
            """
            INSERT INTO friends_family_game_attempts (
              id, user_id, game_key, puzzle_date, puzzle_variant, state_json, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, game_key, puzzle_date, puzzle_variant) DO UPDATE SET
              state_json = excluded.state_json,
              updated_at = excluded.updated_at
            """,
            (
                f"{user_id}:{game_key}:{puzzle_date}:{puzzle_variant}",
                user_id,
                game_key,
                puzzle_date,
                puzzle_variant,
                state_json,
                now,
            ),
        )
