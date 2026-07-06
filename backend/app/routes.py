from __future__ import annotations

import hmac
import json
import random
from datetime import UTC, date, datetime, timedelta

from flask import Blueprint, current_app, jsonify, request

from .auth import (
    create_friends_family_session,
    decode_base64_url,
    encode_token,
    sign_out_friends_family_session,
    sign_payload,
    update_friends_family_avatar,
    validate_friends_family_code,
    verify_friends_family_token,
)
from .daily_answer import FIRST_OFFICIAL_PUZZLE_DATE, get_daily_answer, get_puzzle_date
from .definitions import get_definition
from .game import is_valid_guess, load_valid_guesses, normalize_guess, score_guess
from .notifications import publish_completion_notification
from .stats import (
    AttemptConflictError,
    EMPTY_STATS,
    analyze_solve_path,
    get_family_dashboard,
    get_family_result_for_user,
    get_family_today_status,
    get_stats,
    normalize_board,
    normalize_guesses,
    save_completed_game,
    save_family_daily_attempt,
)


api = Blueprint("api", __name__)
PLAY_TOKEN_KIND = "wordbee-play-puzzle"
PLAY_TOKEN_VERSION = 1
PLAY_MODES = {"random", "past"}
UNTRACKED_PLAYER = {
    "userId": "",
    "displayName": "",
}


@api.get("/health")
def health():
    return jsonify({"ok": True})


@api.get("/today")
def today():
    requested_date = request.args.get("date")
    force_refresh = request.args.get("refresh") == "1"

    try:
        puzzle_date = get_puzzle_date(requested_date)
        answer_record = get_daily_answer(puzzle_date, force_refresh=force_refresh)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503

    return jsonify(
        {
            "date": answer_record["puzzle_date"],
            "answerLength": answer_record["answer_length"],
            "confidence": answer_record["confidence"],
            "status": answer_record["status"],
            "sources": public_sources(answer_record["sources"]),
            "fetchedAt": answer_record["fetched_at"],
        }
    )


@api.get("/stats")
def stats():
    return jsonify(get_stats())


@api.post("/puzzle/random")
def random_puzzle():
    answer = random.SystemRandom().choice(tuple(load_valid_guesses()))
    created_at = datetime.now(UTC).isoformat(timespec="seconds")

    return jsonify(
        public_play_puzzle(
            answer=answer,
            mode="random",
            puzzle_date=get_puzzle_date().isoformat(),
            status="untracked",
            created_at=created_at,
        )
    )


@api.post("/puzzle/past")
def past_puzzle():
    payload = request.get_json(silent=True) or {}

    try:
        requested_puzzle_date = get_puzzle_date(payload.get("date"))
        newest_past_date = get_puzzle_date() - timedelta(days=1)
        puzzle_date = min(
            max(requested_puzzle_date, FIRST_OFFICIAL_PUZZLE_DATE),
            newest_past_date,
        )

        answer_record = get_daily_answer(puzzle_date)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503

    response = public_play_puzzle(
        answer=answer_record["answer"],
        mode="past",
        puzzle_date=answer_record["puzzle_date"],
        status=answer_record["status"],
        confidence=answer_record["confidence"],
        created_at=datetime.now(UTC).isoformat(timespec="seconds"),
    )
    if requested_puzzle_date < FIRST_OFFICIAL_PUZZLE_DATE:
        response["clampedToOldest"] = True
        response["oldestDate"] = FIRST_OFFICIAL_PUZZLE_DATE.isoformat()
    if requested_puzzle_date > newest_past_date:
        response["clampedToNewest"] = True
        response["newestDate"] = newest_past_date.isoformat()

    return jsonify(response)


@api.post("/friends-family/validate-code")
def friends_family_validate_code():
    payload = request.get_json(silent=True) or {}

    if validate_friends_family_code(payload.get("code")) is None:
        return jsonify({"error": "Code not recognized"}), 400

    return jsonify({"ok": True})


@api.post("/friends-family/login")
def friends_family_login():
    payload = request.get_json(silent=True) or {}

    try:
        session = create_friends_family_session(
            code=payload.get("code"),
            avatar=payload.get("avatar"),
            create_user=bool(payload.get("createUser")),
            client_session_id=payload.get("clientSessionId"),
            first_name=payload.get("firstName"),
            last_initial=payload.get("lastInitial"),
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    return jsonify(session)


@api.post("/friends-family/avatar")
def friends_family_avatar():
    payload = request.get_json(silent=True) or {}

    try:
        identity = update_friends_family_avatar(
            payload.get("token"),
            avatar=payload.get("avatar"),
            client_session_id=payload.get("clientSessionId"),
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    if identity is None:
        return jsonify({"error": "Session is active elsewhere"}), 409

    return jsonify({"identity": identity})


@api.post("/friends-family/verify")
def friends_family_verify():
    payload = request.get_json(silent=True) or {}
    identity = verify_friends_family_token(
        payload.get("token"),
        client_session_id=payload.get("clientSessionId"),
        claim_client_session=bool(payload.get("claimSession")),
    )

    if identity is None:
        return jsonify({"error": "Session is active elsewhere"}), 409

    return jsonify({"identity": identity})


@api.post("/friends-family/sign-out")
def friends_family_sign_out():
    payload = request.get_json(silent=True) or {}
    sign_out_friends_family_session(
        payload.get("token"),
        client_session_id=payload.get("clientSessionId"),
    )
    return jsonify({"ok": True})


@api.post("/friends-family/today-status")
def friends_family_today_status():
    payload = request.get_json(silent=True) or {}
    identity = verify_friends_family_token(
        payload.get("token"),
        client_session_id=payload.get("clientSessionId"),
    )

    if identity is None:
        return jsonify({"error": "Session is active elsewhere"}), 409

    try:
        puzzle_date = get_puzzle_date(payload.get("date"))
        validate_available_daily_date(puzzle_date)
        answer_record = get_daily_answer(puzzle_date)
        status = get_family_today_status(
            identity=identity,
            puzzle_date=answer_record["puzzle_date"],
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503

    if status["result"] is not None:
        status["definition"] = get_definition(answer_record["answer"])

    return jsonify(status)


@api.post("/friends-family/stats")
def friends_family_stats():
    payload = request.get_json(silent=True) or {}
    identity = verify_friends_family_token(
        payload.get("token"),
        client_session_id=payload.get("clientSessionId"),
    )

    if identity is None:
        return jsonify({"error": "Session is active elsewhere"}), 409

    current_puzzle_date = get_puzzle_date().isoformat()
    return jsonify(
        get_family_dashboard(
            current_puzzle_date=current_puzzle_date,
            requesting_user_id=identity["userId"],
        )
    )


@api.post("/guess")
def guess():
    payload = request.get_json(silent=True) or {}

    try:
        answer_record = get_answer_record_for_payload(payload)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503

    puzzle_mode = answer_record["mode"]
    friends_family_token = payload.get("friendsFamilyToken")
    friends_family_identity = None
    if puzzle_mode == "daily" and friends_family_token:
        friends_family_identity = verify_friends_family_token(
            friends_family_token,
            client_session_id=payload.get("clientSessionId"),
        )
        if friends_family_identity is None:
            return jsonify({"error": "Session is active elsewhere"}), 409

        existing_result = get_family_result_for_user(
            user_id=friends_family_identity["userId"],
            puzzle_date=answer_record["puzzle_date"],
        )
        if existing_result is not None:
            return jsonify({"error": "Already completed today"}), 409

    normalized_guess = normalize_guess(payload.get("guess"), answer_record["answer_length"])
    if normalized_guess is None:
        return jsonify({"error": "Guess must be five letters"}), 400

    if not is_valid_guess(normalized_guess, answer_record["answer"]):
        return jsonify({"error": "Not in word list"}), 400

    scores = score_guess(answer_record["answer"], normalized_guess)
    did_win = all(score == "correct" for score in scores)
    should_reveal = bool(payload.get("reveal"))

    if puzzle_mode == "daily" and friends_family_identity and not did_win and not should_reveal:
        try:
            save_family_daily_attempt(
                user_id=friends_family_identity["userId"],
                puzzle_date=answer_record["puzzle_date"],
                guess=normalized_guess,
                scores=scores,
                expected_guess_index=get_attempt_index(payload.get("attemptIndex")),
            )
        except AttemptConflictError as exc:
            return jsonify({"error": str(exc)}), 409
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

    response = {
        "date": answer_record["puzzle_date"],
        "mode": puzzle_mode,
        "scores": scores,
        "didWin": did_win,
    }

    if should_reveal:
        response["answer"] = answer_record["answer"]

    return jsonify(response)


@api.post("/results")
def results():
    payload = request.get_json(silent=True) or {}
    friends_family_token = payload.get("friendsFamilyToken")
    friends_family_identity = None

    try:
        puzzle_mode = get_payload_mode(payload)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    if puzzle_mode == "daily" and friends_family_token:
        friends_family_identity = verify_friends_family_token(
            friends_family_token,
            client_session_id=payload.get("clientSessionId"),
        )
        if friends_family_identity is None:
            return jsonify({"error": "Session is active elsewhere"}), 409

    try:
        answer_record = get_answer_record_for_payload(payload)
        if puzzle_mode == "daily":
            saved_result = save_completed_game(
                answer=answer_record["answer"],
                game_id=str(payload.get("gameId") or ""),
                puzzle_date=answer_record["puzzle_date"],
                mode="daily",
                outcome=str(payload.get("outcome") or ""),
                guesses_used=int(payload.get("guessesUsed") or 0),
                board=payload.get("board"),
                guesses=payload.get("guesses"),
                friends_family_identity=friends_family_identity,
            )
        else:
            saved_result = get_untracked_result(
                answer=answer_record["answer"],
                mode=puzzle_mode,
                puzzle_date=answer_record["puzzle_date"],
                game_id=str(payload.get("gameId") or ""),
                outcome=str(payload.get("outcome") or ""),
                guesses_used=int(payload.get("guessesUsed") or 0),
                board=payload.get("board"),
                guesses=payload.get("guesses"),
            )
    except (ValueError, TypeError) as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503

    response = {
        "answer": answer_record["answer"],
        "definition": get_definition(answer_record["answer"]),
        "result": saved_result["result"],
        "stats": saved_result["stats"],
    }

    if saved_result["created"]:
        notification_result = publish_completion_notification(
            board=saved_result["board"],
            friends_family_identity=friends_family_identity,
            guesses_used=int(payload.get("guessesUsed") or 0),
        )

        if notification_result["reason"] == "request_failed":
            current_app.logger.warning(
                "Could not publish friends and family completion notification: %s",
                notification_result.get("error", "unknown error"),
            )

    return jsonify(response)


def public_play_puzzle(
    *,
    answer: str,
    mode: str,
    puzzle_date: str,
    status: str,
    created_at: str,
    confidence: float = 1.0,
):
    return {
        "answerLength": len(answer),
        "confidence": confidence,
        "date": puzzle_date,
        "mode": mode,
        "puzzleId": encode_token(
            {
                "answer": answer.upper(),
                "createdAt": created_at,
                "date": puzzle_date,
                "kind": PLAY_TOKEN_KIND,
                "mode": mode,
                "version": PLAY_TOKEN_VERSION,
            }
        ),
        "status": status,
    }


def get_payload_mode(payload) -> str:
    mode = payload.get("mode", "daily")
    if mode is None:
        return "daily"

    if not isinstance(mode, str):
        raise ValueError("Invalid puzzle mode")

    normalized_mode = mode.strip().lower() or "daily"
    if normalized_mode != "daily" and normalized_mode not in PLAY_MODES:
        raise ValueError("Invalid puzzle mode")

    return normalized_mode


def get_attempt_index(raw_index) -> int | None:
    if raw_index is None:
        return None

    try:
        attempt_index = int(raw_index)
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid attempt index") from exc

    if attempt_index < 0 or attempt_index >= 6:
        raise ValueError("Invalid attempt index")

    return attempt_index


def validate_available_daily_date(puzzle_date: date) -> None:
    if puzzle_date > get_puzzle_date():
        raise ValueError("Daily Wordle is not available yet")


def get_answer_record_for_payload(payload):
    mode = get_payload_mode(payload)
    if mode == "daily":
        puzzle_date = get_puzzle_date(payload.get("date"))
        validate_available_daily_date(puzzle_date)
        answer_record = get_daily_answer(puzzle_date)
        return {
            "answer": answer_record["answer"],
            "answer_length": answer_record["answer_length"],
            "mode": "daily",
            "puzzle_date": answer_record["puzzle_date"],
        }

    play_payload = verify_play_puzzle_token(payload.get("puzzleId"), mode)
    if play_payload is None:
        raise ValueError("Invalid puzzle")

    return {
        "answer": play_payload["answer"],
        "answer_length": len(play_payload["answer"]),
        "mode": mode,
        "puzzle_date": play_payload["date"],
    }


def verify_play_puzzle_token(raw_token: object, expected_mode: str) -> dict[str, str] | None:
    if not isinstance(raw_token, str) or "." not in raw_token:
        return None

    encoded_payload, encoded_signature = raw_token.split(".", 1)
    if not hmac.compare_digest(sign_payload(encoded_payload), encoded_signature):
        return None

    try:
        payload = json.loads(decode_base64_url(encoded_payload))
    except (ValueError, json.JSONDecodeError):
        return None

    answer = normalize_guess(payload.get("answer"), 5)
    if (
        payload.get("kind") != PLAY_TOKEN_KIND
        or payload.get("version") != PLAY_TOKEN_VERSION
        or payload.get("mode") != expected_mode
        or answer is None
        or not isinstance(payload.get("date"), str)
    ):
        return None

    return {
        "answer": answer,
        "date": payload["date"],
        "mode": expected_mode,
    }


def get_untracked_result(
    *,
    answer: str,
    mode: str,
    puzzle_date: str,
    game_id: str,
    outcome: str,
    guesses_used: int,
    board,
    guesses,
):
    if outcome not in {"won", "lost"}:
        raise ValueError("Invalid outcome")

    if guesses_used < 1 or guesses_used > 6:
        raise ValueError("Invalid guess count")

    normalized_board = normalize_board(board)
    normalized_guesses = normalize_guesses(guesses)
    if len(normalized_board) != guesses_used or len(normalized_guesses) != guesses_used:
        raise ValueError("Completed result does not match guess count")

    normalized_answer = answer.upper()
    return {
        "board": normalized_board,
        "created": False,
        "result": {
            "analysis": analyze_solve_path(
                answer=normalized_answer,
                guesses=tuple(normalized_guesses),
                outcome=outcome,
            ),
            "answer": normalized_answer,
            "board": normalized_board,
            "completedAt": datetime.now(UTC).isoformat(timespec="seconds"),
            "date": puzzle_date,
            "displayName": UNTRACKED_PLAYER["displayName"],
            "guesses": normalized_guesses,
            "guessesUsed": guesses_used,
            "id": f"{mode}:{game_id or datetime.now(UTC).timestamp()}",
            "outcome": outcome,
            "starterWord": normalized_guesses[0],
            "userId": UNTRACKED_PLAYER["userId"],
        },
        "stats": dict(EMPTY_STATS),
    }


def public_sources(sources):
    return [
        {key: value for key, value in source.items() if key != "answer"}
        for source in sources
    ]
