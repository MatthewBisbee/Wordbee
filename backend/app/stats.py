from __future__ import annotations

import json
import math
from collections import Counter
from datetime import date, datetime, timedelta
from functools import lru_cache
from typing import Any

from .db import connect
from .game import load_valid_guesses, score_guess


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
    "averageSkill": 0,
    "averageLuck": 0,
    "favoriteStarter": None,
}
VALID_STATES = {"correct", "present", "absent"}
RECOMMENDED_STARTERS = (
    "SLATE",
    "CRANE",
    "TRACE",
    "CRATE",
    "CARTE",
    "STARE",
    "RAISE",
    "ARISE",
    "SAINT",
    "LEAST",
    "PLANE",
    "REACT",
    "AUDIO",
    "ADIEU",
)
MAX_OPENING_GUESSES_TO_SCORE = 56
MAX_MIDGAME_GUESSES_TO_SCORE = 90


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
    current_puzzle_date: str | None = None,
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
                "canRevealCurrentDay": False,
                "currentDate": current_puzzle_date,
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

    results_by_user: dict[str, list[dict[str, Any]]] = {row["id"]: [] for row in user_rows}
    raw_results = []
    for row in result_rows:
        result = serialize_result(row, include_analysis=True)
        results_by_user.setdefault(row["user_id"], []).append(result)
        raw_results.append(result)

    can_reveal_current_day = not current_puzzle_date or any(
        result["userId"] == requesting_user_id and result["date"] == current_puzzle_date
        for result in raw_results
    )

    def is_locked_current_day_result(result: dict[str, Any]) -> bool:
        return (
            bool(current_puzzle_date)
            and not can_reveal_current_day
            and result["date"] == current_puzzle_date
        )

    users = []
    for user_row in user_rows:
        user_results = results_by_user.get(user_row["id"], [])
        visible_user_results = [
            result for result in user_results if not is_locked_current_day_result(result)
        ]
        history = [
            lock_current_day_result(result) if is_locked_current_day_result(result) else result
            for result in reversed(user_results)
        ]
        stats = calculate_user_stats(visible_user_results)
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

    visible_results = [
        result for result in raw_results if not is_locked_current_day_result(result)
    ]
    display_results = [
        lock_current_day_result(result) if is_locked_current_day_result(result) else result
        for result in raw_results
    ]
    group = calculate_group_stats(visible_results, users)
    locked_current_day_results = [
        result for result in raw_results if is_locked_current_day_result(result)
    ]
    if current_puzzle_date and locked_current_day_results:
        group["timeline"] = add_locked_timeline_day(
            group["timeline"],
            current_puzzle_date,
            locked_current_day_results,
        )
        group["recentResults"] = list(reversed(display_results))[:36]

    return {
        "canRevealCurrentDay": can_reveal_current_day,
        "currentDate": current_puzzle_date,
        "currentUserId": requesting_user_id,
        "group": group,
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
    analyses = [result["analysis"] for result in sorted_results if result.get("analysis")]

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
        "averageSkill": average_metric(analyses, "skill"),
        "averageLuck": average_metric(analyses, "luck"),
        "favoriteStarter": top_starters[0] if top_starters else None,
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


def serialize_result(row: Any, *, include_analysis: bool = False) -> dict[str, Any]:
    guesses = json.loads(row["guesses_json"])
    board = json.loads(row["board_json"])

    result = {
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

    if include_analysis:
        result["analysis"] = analyze_solve_path(
            answer=row["answer"],
            guesses=tuple(guesses),
            outcome=row["outcome"],
        )

    return result


def lock_current_day_result(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": result["id"],
        "userId": result["userId"],
        "displayName": result["displayName"],
        "date": result["date"],
        "outcome": result["outcome"],
        "guessesUsed": 0,
        "starterWord": "",
        "guesses": [],
        "board": [],
        "completedAt": result["completedAt"],
        "locked": True,
    }


def add_locked_timeline_day(
    timeline: list[dict[str, Any]],
    current_puzzle_date: str,
    current_day_results: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    locked_day = {
        "date": current_puzzle_date,
        "answer": "",
        "players": len(current_day_results),
        "wins": 0,
        "winPercentage": 0,
        "averageGuesses": 0,
        "averageSkill": 0,
        "averageLuck": 0,
        "topStarter": "",
        "bestPlayer": "",
        "bestScore": "",
        "locked": True,
    }
    unlocked_days = [day for day in timeline if day["date"] != current_puzzle_date]
    return sorted([*unlocked_days, locked_day], key=lambda day: day["date"])[-42:]


def calculate_group_stats(
    results: list[dict[str, Any]],
    users: list[dict[str, Any]],
) -> dict[str, Any]:
    sorted_results = sorted(results, key=lambda result: (result["date"], result["completedAt"]))
    played = len(sorted_results)
    wins = [result for result in sorted_results if result["outcome"] == "won"]
    distribution = dict(DEFAULT_DISTRIBUTION)
    for result in wins:
        distribution[str(result["guessesUsed"])] += 1

    analyses = [result["analysis"] for result in sorted_results if result.get("analysis")]
    starter_stats = calculate_starter_stats(sorted_results)
    timeline = calculate_daily_timeline(sorted_results)

    return {
        "played": played,
        "wins": len(wins),
        "winPercentage": round((len(wins) / played) * 100) if played else 0,
        "averageGuesses": round(
            sum(result["guessesUsed"] for result in sorted_results) / played,
            1,
        )
        if played
        else 0,
        "averageSkill": average_metric(analyses, "skill"),
        "averageLuck": average_metric(analyses, "luck"),
        "daysTracked": len({result["date"] for result in sorted_results}),
        "players": len(users),
        "guessDistribution": distribution,
        "topStarters": starter_stats[:12],
        "timeline": timeline,
        "recentResults": list(reversed(sorted_results))[:36],
        "bestDay": min(timeline, key=lambda day: day["averageGuesses"], default=None),
        "toughestDay": max(timeline, key=lambda day: day["averageGuesses"], default=None),
    }


def calculate_starter_stats(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    starters: dict[str, list[dict[str, Any]]] = {}
    for result in results:
        starters.setdefault(result["starterWord"], []).append(result)

    stats = []
    total = len(results) or 1
    for word, word_results in starters.items():
        wins = [result for result in word_results if result["outcome"] == "won"]
        stats.append(
            {
                "word": word,
                "count": len(word_results),
                "percentage": round((len(word_results) / total) * 100),
                "users": len({result["userId"] for result in word_results}),
                "averageGuesses": round(
                    sum(result["guessesUsed"] for result in word_results) / len(word_results),
                    1,
                ),
                "winPercentage": round((len(wins) / len(word_results)) * 100),
            }
        )

    return sorted(
        stats,
        key=lambda stat: (-stat["count"], stat["averageGuesses"], stat["word"]),
    )


def calculate_daily_timeline(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_date: dict[str, list[dict[str, Any]]] = {}
    for result in results:
        by_date.setdefault(result["date"], []).append(result)

    timeline = []
    for day, day_results in sorted(by_date.items()):
        wins = [result for result in day_results if result["outcome"] == "won"]
        starter_counts = Counter(result["starterWord"] for result in day_results)
        best_result = min(
            day_results,
            key=lambda result: (
                0 if result["outcome"] == "won" else 1,
                result["guessesUsed"],
                result["completedAt"],
            ),
        )
        analyses = [result["analysis"] for result in day_results if result.get("analysis")]
        timeline.append(
            {
                "date": day,
                "answer": day_results[0]["answer"],
                "players": len(day_results),
                "wins": len(wins),
                "winPercentage": round((len(wins) / len(day_results)) * 100),
                "averageGuesses": round(
                    sum(result["guessesUsed"] for result in day_results) / len(day_results),
                    1,
                ),
                "averageSkill": average_metric(analyses, "skill"),
                "averageLuck": average_metric(analyses, "luck"),
                "topStarter": starter_counts.most_common(1)[0][0],
                "bestPlayer": best_result["displayName"],
                "bestScore": format_result_score(best_result),
            }
        )

    return timeline[-42:]


def average_metric(records: list[dict[str, Any]], key: str) -> int:
    values = [record.get(key) for record in records if isinstance(record.get(key), int | float)]
    if not values:
        return 0
    return round(sum(values) / len(values))


@lru_cache(maxsize=512)
def analyze_solve_path(
    *,
    answer: str,
    guesses: tuple[str, ...],
    outcome: str,
) -> dict[str, Any]:
    normalized_answer = answer.upper()
    candidates = get_initial_candidates(normalized_answer)
    steps = []

    for index, guess in enumerate(guesses, start=1):
        step, candidates = analyze_guess_step(
            answer=normalized_answer,
            candidates=candidates,
            guess=guess.upper(),
            turn=index,
        )
        steps.append(step)

    skill = average_metric(steps, "skill")
    luck = average_metric(steps, "luck")
    return {
        "skill": skill,
        "luck": luck,
        "steps": steps,
        "remainingAfterLast": steps[-1]["after"] if steps else len(candidates),
        "openerScore": steps[0]["skill"] if steps else 0,
        "pathLabel": create_path_label(outcome=outcome, guesses_used=len(guesses), skill=skill),
    }


def analyze_guess_step(
    *,
    answer: str,
    candidates: tuple[str, ...],
    guess: str,
    turn: int,
) -> tuple[dict[str, Any], tuple[str, ...]]:
    before = max(1, len(candidates))
    pattern = tuple(score_guess(answer, guess))
    partition = Counter(tuple(score_guess(candidate, guess)) for candidate in candidates)
    matching_candidates = tuple(
        candidate for candidate in candidates if tuple(score_guess(candidate, guess)) == pattern
    )
    if answer not in matching_candidates:
        matching_candidates = tuple(sorted({*matching_candidates, answer}))

    after = max(1, len(matching_candidates))
    best_guess, best_after = find_best_available_guess(
        actual_guess=guess,
        candidates=candidates,
        turn=turn,
    )
    expected_after = sum(count * count for count in partition.values()) / before
    luck = calculate_luck_score(
        after=after,
        expected_after=expected_after,
        smallest_after=min(partition.values(), default=after),
        largest_after=max(partition.values(), default=after),
    )
    skill = calculate_skill_score(
        before=before,
        after=expected_after,
        best_after=best_after,
    )

    return (
        {
            "turn": turn,
            "guess": guess,
            "states": list(pattern),
            "before": before,
            "after": after,
            "eliminated": max(0, before - after),
            "eliminatedPercentage": round(((before - after) / before) * 100),
            "bestWord": best_guess,
            "bestRemaining": round(best_after, 1),
            "skill": skill,
            "luck": luck,
            "expectedRemaining": round(expected_after, 1),
        },
        matching_candidates,
    )


def find_best_available_guess(
    *,
    actual_guess: str,
    candidates: tuple[str, ...],
    turn: int,
) -> tuple[str, float]:
    guess_pool = get_analysis_guess_pool(
        actual_guess=actual_guess,
        candidates=candidates,
        turn=turn,
    )
    best_guess = actual_guess
    best_after = float(len(candidates))

    for candidate_guess in guess_pool:
        partition = Counter(
            tuple(score_guess(candidate, candidate_guess)) for candidate in candidates
        )
        before = max(1, len(candidates))
        after = sum(count * count for count in partition.values()) / before
        if after < best_after or (after == best_after and candidate_guess == actual_guess):
            best_guess = candidate_guess
            best_after = after

    return best_guess, max(1, best_after)


def get_analysis_guess_pool(
    *,
    actual_guess: str,
    candidates: tuple[str, ...],
    turn: int,
) -> tuple[str, ...]:
    pool = [actual_guess]
    if turn == 1:
        pool.extend(RECOMMENDED_STARTERS)
        pool.extend(get_ranked_openers()[:MAX_OPENING_GUESSES_TO_SCORE])
    elif len(candidates) <= MAX_MIDGAME_GUESSES_TO_SCORE:
        pool.extend(candidates)
    else:
        pool.extend(candidates[:MAX_MIDGAME_GUESSES_TO_SCORE])
        pool.extend(RECOMMENDED_STARTERS[:6])

    valid_words = get_analysis_words_set()
    unique_pool = []
    seen = set()
    for word in pool:
        normalized = word.upper()
        if normalized in seen:
            continue
        if normalized not in valid_words:
            continue
        unique_pool.append(normalized)
        seen.add(normalized)

    return tuple(unique_pool)


def calculate_skill_score(*, before: int, after: float, best_after: float) -> int:
    if before <= 1:
        return 100

    possible_gain = max(1, before - best_after)
    actual_gain = max(0, before - after)
    return max(0, min(100, round((actual_gain / possible_gain) * 100)))


def calculate_luck_score(
    *,
    after: int,
    expected_after: float,
    smallest_after: int,
    largest_after: int,
) -> int:
    if largest_after == smallest_after:
        return 50

    if after <= expected_after:
        denominator = max(1, expected_after - smallest_after)
        return max(50, min(100, round(50 + 50 * ((expected_after - after) / denominator))))

    denominator = max(1, largest_after - expected_after)
    return max(0, min(50, round(50 - 50 * ((after - expected_after) / denominator))))


def create_path_label(*, outcome: str, guesses_used: int, skill: int) -> str:
    if outcome == "lost":
        return "Stumped"
    if guesses_used <= 2:
        return "Fast solve"
    if skill >= 85:
        return "Efficient path"
    if guesses_used <= 4:
        return "Solid solve"
    return "Close finish"


@lru_cache(maxsize=1)
def get_analysis_words() -> tuple[str, ...]:
    return tuple(sorted(load_valid_guesses()))


@lru_cache(maxsize=1)
def get_analysis_words_set() -> frozenset[str]:
    return frozenset(get_analysis_words())


def get_initial_candidates(answer: str) -> tuple[str, ...]:
    return tuple(sorted({*get_analysis_words(), answer}))


@lru_cache(maxsize=1)
def get_ranked_openers() -> tuple[str, ...]:
    words = get_analysis_words()
    position_counts = [Counter(word[index] for word in words) for index in range(5)]
    letter_counts = Counter(letter for word in words for letter in set(word))
    ranked = sorted(
        words,
        key=lambda word: (
            -score_opener(word, position_counts=position_counts, letter_counts=letter_counts),
            word,
        ),
    )
    return tuple(ranked)


def score_opener(
    word: str,
    *,
    position_counts: list[Counter[str]],
    letter_counts: Counter[str],
) -> float:
    unique_letters = set(word)
    repeat_penalty = len(word) - len(unique_letters)
    return (
        sum(math.log(letter_counts[letter] + 1) for letter in unique_letters)
        + sum(math.log(position_counts[index][letter] + 1) for index, letter in enumerate(word))
        - repeat_penalty * 3
    )


def format_result_score(result: dict[str, Any]) -> str:
    return f"{result['guessesUsed']}/6" if result["outcome"] == "won" else "X/6"


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
