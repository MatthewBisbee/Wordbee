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

    if game_key == "connections":
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
    if game_key in {"connections", "strands"}:
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
