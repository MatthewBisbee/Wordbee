from __future__ import annotations

import json
from collections import Counter
from datetime import date, datetime, timedelta
from typing import Any

from .db import connect


DEFAULT_DISTRIBUTION = {str(index): 0 for index in range(1, 7)}
EMPTY_STATS = {
    "played": 0,
    "wins": 0,
    "winPercentage": 0,
    "averageGuesses": 0,
    "currentStreak": 0,
    "maxStreak": 0,
    "currentWinStreak": 0,
    "bestWinStreak": 0,
    "currentPlayStreak": 0,
    "bestPlayStreak": 0,
    "guessDistribution": DEFAULT_DISTRIBUTION,
    "topStarters": [],
}
VALID_STATES = {"correct", "present", "absent"}


def save_completed_game(
    *,
    game_id: str,
    puzzle_date: str,
    answer: str,
    mode: str,
    outcome: str,
    guesses_used: int,
    board: list[list[str]],
    guesses: list[str],
    friends_family_identity: dict[str, str] | None = None,
) -> dict[str, Any]:
    if not game_id:
        raise ValueError("Missing game id")

    if mode != "daily":
        raise ValueError("Only daily results are tracked")

    if outcome not in {"won", "lost"}:
        raise ValueError("Invalid outcome")

    if guesses_used < 1 or guesses_used > 6:
        raise ValueError("Invalid guess count")

    normalized_board = normalize_board(board)
    normalized_guesses = normalize_guesses(guesses)
    if len(normalized_board) != guesses_used or len(normalized_guesses) != guesses_used:
        raise ValueError("Completed result does not match guess count")

    if friends_family_identity is None:
        return {
            "board": normalized_board,
            "created": False,
            "result": None,
            "stats": dict(EMPTY_STATS),
        }

    user_id = friends_family_identity.get("userId")
    if not user_id:
        raise ValueError("Friends and family sign-in required")

    result_id = f"{user_id}:{puzzle_date}"
    now = datetime.now().astimezone().isoformat()

    with connect() as connection:
        cursor = connection.execute(
            """
            INSERT OR IGNORE INTO friends_family_daily_results (
              id, user_id, puzzle_date, answer, outcome, guesses_used,
              starter_word, guesses_json, board_json, completed_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                result_id,
                user_id,
                puzzle_date,
                answer.upper(),
                outcome,
                guesses_used,
                normalized_guesses[0],
                json.dumps(normalized_guesses, separators=(",", ":")),
                json.dumps(normalized_board, separators=(",", ":")),
                now,
            ),
        )
        created = cursor.rowcount == 1

    result = get_family_result_for_user(user_id=user_id, puzzle_date=puzzle_date)

    return {
        "board": normalized_board,
        "created": created,
        "result": result,
        "stats": calculate_user_stats_for_id(user_id),
    }


def get_family_result_for_user(*, user_id: str, puzzle_date: str) -> dict[str, Any] | None:
    with connect() as connection:
        row = connection.execute(
            """
            SELECT results.*, users.display_name
            FROM friends_family_daily_results AS results
            JOIN friends_family_users AS users ON users.id = results.user_id
            WHERE results.user_id = ? AND results.puzzle_date = ?
            """,
            (user_id, puzzle_date),
        ).fetchone()

    return serialize_result(row) if row else None


def get_family_today_status(
    *,
    identity: dict[str, str],
    puzzle_date: str,
) -> dict[str, Any]:
    result = get_family_result_for_user(
        user_id=identity["userId"],
        puzzle_date=puzzle_date,
    )

    return {
        "completed": result is not None,
        "result": result,
        "stats": calculate_user_stats_for_id(identity["userId"]),
    }


def get_family_dashboard(
    *,
    requesting_user_id: str,
) -> dict[str, Any]:
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
                "users": [],
            }

        user_rows = connection.execute(
            """
            SELECT id, display_name, first_name, last_initial
            FROM friends_family_users
            WHERE code_id = ?
            ORDER BY first_name COLLATE NOCASE ASC, last_initial COLLATE NOCASE ASC
            """,
            (requesting_user["code_id"],),
        ).fetchall()
        result_rows = connection.execute(
            """
            SELECT results.*, users.display_name
            FROM friends_family_daily_results AS results
            JOIN friends_family_users AS users ON users.id = results.user_id
            WHERE users.code_id = ?
            ORDER BY results.puzzle_date ASC, results.completed_at ASC
            """,
            (requesting_user["code_id"],),
        ).fetchall()

    results_by_user: dict[str, list[dict[str, Any]]] = {
        row["id"]: [] for row in user_rows
    }
    for row in result_rows:
        results_by_user.setdefault(row["user_id"], []).append(serialize_result(row))

    users = []
    for user_row in user_rows:
        history = list(reversed(results_by_user.get(user_row["id"], [])))
        stats = calculate_user_stats(results_by_user.get(user_row["id"], []))
        users.append(
            {
                "id": user_row["id"],
                "displayName": user_row["display_name"],
                "firstName": user_row["first_name"],
                "lastInitial": user_row["last_initial"],
                "stats": stats,
                "history": history,
            }
        )

    return {
        "currentUserId": requesting_user_id,
        "users": users,
    }


def calculate_user_stats_for_id(user_id: str) -> dict[str, Any]:
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT results.*, users.display_name
            FROM friends_family_daily_results AS results
            JOIN friends_family_users AS users ON users.id = results.user_id
            WHERE results.user_id = ?
            ORDER BY results.puzzle_date ASC
            """,
            (user_id,),
        ).fetchall()

    return calculate_user_stats([serialize_result(row) for row in rows])


def calculate_user_stats(results: list[dict[str, Any]]) -> dict[str, Any]:
    if not results:
        return dict(EMPTY_STATS)

    sorted_results = sorted(results, key=lambda result: result["date"])
    played = len(sorted_results)
    wins = [result for result in sorted_results if result["outcome"] == "won"]
    distribution = dict(DEFAULT_DISTRIBUTION)

    for result in wins:
        distribution[str(result["guessesUsed"])] += 1

    starter_counts = Counter(result["starterWord"] for result in sorted_results)
    top_starters = [
        {
            "word": word,
            "count": count,
            "percentage": round((count / played) * 100),
        }
        for word, count in starter_counts.most_common(10)
    ]

    return {
        "played": played,
        "wins": len(wins),
        "winPercentage": round((len(wins) / played) * 100),
        "averageGuesses": round(
            sum(result["guessesUsed"] for result in sorted_results) / played,
            1,
        ),
        "currentStreak": calculate_current_streak(sorted_results, require_win=True),
        "maxStreak": calculate_best_streak(sorted_results, require_win=True),
        "currentWinStreak": calculate_current_streak(sorted_results, require_win=True),
        "bestWinStreak": calculate_best_streak(sorted_results, require_win=True),
        "currentPlayStreak": calculate_current_streak(sorted_results, require_win=False),
        "bestPlayStreak": calculate_best_streak(sorted_results, require_win=False),
        "guessDistribution": distribution,
        "topStarters": top_starters,
    }


def calculate_current_streak(results: list[dict[str, Any]], *, require_win: bool) -> int:
    if not results:
        return 0

    streak = 0
    expected_date: date | None = None

    for result in reversed(results):
        result_date = parse_puzzle_date(result["date"])
        if expected_date is not None and result_date != expected_date:
            break

        if require_win and result["outcome"] != "won":
            break

        streak += 1
        expected_date = result_date - timedelta(days=1)

    return streak


def calculate_best_streak(results: list[dict[str, Any]], *, require_win: bool) -> int:
    best = 0
    running = 0
    previous_date: date | None = None

    for result in results:
        result_date = parse_puzzle_date(result["date"])
        is_consecutive = previous_date is None or result_date == previous_date + timedelta(days=1)
        is_counted = not require_win or result["outcome"] == "won"

        if is_consecutive and is_counted:
            running += 1
        elif is_counted:
            running = 1
        else:
            running = 0

        best = max(best, running)
        previous_date = result_date

    return best


def serialize_result(row: Any) -> dict[str, Any]:
    guesses = json.loads(row["guesses_json"])
    board = json.loads(row["board_json"])

    return {
        "id": row["id"],
        "userId": row["user_id"],
        "displayName": row["display_name"],
        "date": row["puzzle_date"],
        "answer": row["answer"],
        "outcome": row["outcome"],
        "guessesUsed": row["guesses_used"],
        "starterWord": row["starter_word"],
        "guesses": guesses,
        "board": board,
        "completedAt": row["completed_at"],
    }


def get_stats(mode: str = "daily") -> dict[str, Any]:
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT puzzle_date, outcome, guesses_used, completed_at
            FROM completed_games
            WHERE mode = ?
            ORDER BY completed_at ASC
            """,
            (mode,),
        ).fetchall()

    played = len(rows)
    wins = [row for row in rows if row["outcome"] == "won"]
    distribution = dict(DEFAULT_DISTRIBUTION)

    for row in wins:
        distribution[str(row["guesses_used"])] += 1

    current_streak = 0
    for row in reversed(rows):
        if row["outcome"] != "won":
            break
        current_streak += 1

    max_streak = 0
    running_streak = 0
    for row in rows:
        if row["outcome"] == "won":
            running_streak += 1
        else:
            running_streak = 0
        max_streak = max(max_streak, running_streak)

    return {
        "played": played,
        "wins": len(wins),
        "winPercentage": round((len(wins) / played) * 100) if played else 0,
        "averageGuesses": round(
            sum(row["guesses_used"] for row in rows) / played,
            1,
        )
        if played
        else 0,
        "currentStreak": current_streak,
        "maxStreak": max_streak,
        "currentWinStreak": current_streak,
        "bestWinStreak": max_streak,
        "currentPlayStreak": played,
        "bestPlayStreak": played,
        "guessDistribution": distribution,
        "topStarters": [],
    }


def normalize_board(board: list[list[str]]) -> list[list[str]]:
    normalized_board: list[list[str]] = []

    if not isinstance(board, list):
        raise ValueError("Invalid board")

    for row in board:
        if not isinstance(row, list) or len(row) != 5:
            raise ValueError("Invalid board")

        normalized_row = []
        for state in row:
            if state not in VALID_STATES:
                raise ValueError("Invalid board")
            normalized_row.append(state)

        normalized_board.append(normalized_row)

    if not normalized_board or len(normalized_board) > 6:
        raise ValueError("Invalid board")

    return normalized_board


def normalize_guesses(guesses: list[str]) -> list[str]:
    if not isinstance(guesses, list):
        raise ValueError("Invalid guesses")

    normalized_guesses = []
    for guess in guesses:
        if not isinstance(guess, str):
            raise ValueError("Invalid guesses")

        normalized_guess = guess.strip().upper()
        if len(normalized_guess) != 5 or not normalized_guess.isalpha():
            raise ValueError("Invalid guesses")

        normalized_guesses.append(normalized_guess)

    if not normalized_guesses or len(normalized_guesses) > 6:
        raise ValueError("Invalid guesses")

    return normalized_guesses


def parse_puzzle_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()
