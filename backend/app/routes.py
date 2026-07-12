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
from .games.connections import (
    check_connections_guess,
    get_connections_puzzle,
    public_connections_solution,
)
from .games.letterboxed import (
    check_letterboxed_word,
    get_letterboxed_puzzle,
    public_letterboxed_solution,
    validate_letterboxed_solution,
)
from .games.crossword import (
    check_crossword,
    get_crossword_puzzle,
    public_crossword_solution,
    validate_crossword_solution,
)
from .games.midi import (
    check_midi,
    get_midi_puzzle,
    public_midi_solution,
    validate_midi_solution,
)
from .games.mini import (
    check_mini,
    get_mini_puzzle,
    public_mini_solution,
    validate_mini_solution,
)
from .games.pips import (
    get_pips_puzzle,
    public_pips_solution,
    validate_pips_solution,
)
from .games.registry import (
    GAME_KEYS,
    get_game_first_date,
    get_public_puzzle,
    resolve_multigame_date,
)
from .games.results import (
    get_multigame_attempt,
    get_multigame_calendar,
    get_multigame_dashboard,
    get_multigame_result_for_user,
    save_multigame_attempt,
    save_multigame_result,
    upsert_letterboxed_result,
    upsert_spellingbee_result,
)
from .games.spellingbee import (
    check_spellingbee_word,
    get_spellingbee_puzzle,
    summarize_progress,
)
from .games.strands import (
    check_strands_guess,
    get_strands_hint,
    get_strands_puzzle,
    public_strands_solution,
)
from .games.sudoku import get_sudoku_hint, validate_sudoku_grid
from .games.tiles import generate_board, get_tiles_palette, resolve_default_palette, simulate_moves
from .games.wordle import (
    get_answer_repeats,
    is_valid_guess,
    load_valid_guesses,
    normalize_guess,
    score_guess,
)
from .notifications import publish_completion_notification, publish_contact_notification
from .stats import (
    AttemptConflictError,
    EMPTY_STATS,
    analyze_solve_path,
    get_family_calendar,
    get_family_dashboard,
    get_family_result_for_user,
    get_family_today_status,
    get_stats,
    normalize_board,
    normalize_guesses,
    record_retro_family_result,
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


@api.post("/contact")
def contact():
    payload = request.get_json(silent=True) or {}
    suggestion = normalize_contact_message(payload.get("message"))

    if suggestion is None:
        return jsonify({"error": "Suggestion is required"}), 400

    contact_identity = get_contact_identity(payload)
    notification_result = publish_contact_notification(
        message=suggestion,
        first_name=contact_identity["firstName"] if contact_identity else "",
        last_initial=contact_identity["lastInitial"] if contact_identity else "",
    )

    if notification_result["reason"] == "request_failed":
        current_app.logger.warning(
            "Could not publish suggestion notification: %s",
            notification_result.get("error", "unknown error"),
        )
        return jsonify({"error": "Could not send suggestion"}), 502

    if notification_result["reason"] == "missing_topic":
        return jsonify({"error": "Suggestion notifications are not configured"}), 503

    if notification_result["reason"] == "disabled":
        return jsonify({"error": "Suggestion notifications are unavailable"}), 503

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


@api.get("/games/<game_key>/today")
def multigame_today(game_key: str):
    if game_key not in GAME_KEYS:
        return jsonify({"error": "Invalid game"}), 404

    try:
        requested_date = get_puzzle_date(request.args.get("date"))
        puzzle_date, clamp_info = resolve_multigame_date(game_key, requested_date)
        force_refresh = request.args.get("refresh") == "1"
        payload = get_public_puzzle(
            game_key,
            puzzle_date,
            {"difficulty": request.args.get("difficulty", "medium")},
            force_refresh=force_refresh,
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503

    payload["firstDate"] = get_game_first_date(game_key).isoformat()
    payload.update(clamp_info)
    return jsonify(payload)


@api.post("/games/connections/guess")
def multigame_connections_guess():
    payload = request.get_json(silent=True) or {}

    try:
        puzzle_date = resolve_playable_multigame_date("connections", payload.get("date"))
        return jsonify(check_connections_guess(puzzle_date, payload.get("cards")))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503


@api.post("/games/connections/reveal")
def multigame_connections_reveal():
    payload = request.get_json(silent=True) or {}

    try:
        puzzle_date = resolve_playable_multigame_date("connections", payload.get("date"))
        puzzle = get_connections_puzzle(puzzle_date)
        return jsonify({"groups": public_connections_solution(puzzle)})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503


@api.post("/games/letterboxed/guess")
def multigame_letterboxed_guess():
    payload = request.get_json(silent=True) or {}

    try:
        puzzle_date = resolve_playable_multigame_date("letterboxed", payload.get("date"))
        return jsonify(
            check_letterboxed_word(
                puzzle_date,
                payload.get("word"),
                payload.get("previousWord"),
            )
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503


@api.post("/games/letterboxed/reveal")
def multigame_letterboxed_reveal():
    payload = request.get_json(silent=True) or {}

    try:
        puzzle_date = resolve_playable_multigame_date("letterboxed", payload.get("date"))
        puzzle = get_letterboxed_puzzle(puzzle_date)
        return jsonify(public_letterboxed_solution(puzzle))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503


@api.post("/games/spellingbee/guess")
def multigame_spellingbee_guess():
    payload = request.get_json(silent=True) or {}

    try:
        puzzle_date = resolve_playable_multigame_date("spellingbee", payload.get("date"))
        return jsonify(check_spellingbee_word(puzzle_date, payload.get("word")))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503


@api.post("/games/spellingbee/progress")
def multigame_spellingbee_progress():
    """Persist and merge a Spelling Bee day's found words.

    The client sends the words it knows about; for a signed-in user they are
    unioned with whatever is already stored for that day (its own device or
    another), re-scored, and written back. The authoritative merged aggregate is
    returned so every device converges on the same found set and rank. Guests get
    the computed aggregate for their own words without persistence.
    """
    payload = request.get_json(silent=True) or {}
    identity = verify_optional_friends_family_identity(payload)
    if payload.get("friendsFamilyToken") and identity is None:
        return jsonify({"error": "Session is active elsewhere"}), 409

    try:
        puzzle_date = resolve_playable_multigame_date("spellingbee", payload.get("date"))
        puzzle = get_spellingbee_puzzle(puzzle_date)
        incoming_words = payload.get("words")
        if not isinstance(incoming_words, list):
            incoming_words = []

        if identity is None:
            return jsonify(summarize_progress(puzzle, incoming_words))

        user_id = identity["userId"]
        variant = "daily"
        existing = get_multigame_result_for_user(
            user_id=user_id,
            game_key="spellingbee",
            puzzle_date=puzzle_date.isoformat(),
            puzzle_variant=variant,
        )
        prior_words = (existing["score"].get("words") if existing else None) or []
        summary = summarize_progress(puzzle, [*prior_words, *incoming_words])

        result = upsert_spellingbee_result(
            user_id=user_id,
            puzzle_date=puzzle_date.isoformat(),
            puzzle_variant=variant,
            score=summary,
        )
        return jsonify({**summary, "saved": result is not None})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503


@api.post("/games/tiles/palette")
def multigame_tiles_palette():
    """Lazily serve one palette's art for the client's palette switcher."""
    payload = request.get_json(silent=True) or {}
    try:
        return jsonify(get_tiles_palette(payload.get("filename")))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503


@api.post("/games/tiles/result")
def multigame_tiles_result():
    """Record a cleared Tiles board with a server-authoritative longest combo.

    The client sends the sequence of two-tile selections; the server regenerates
    the day's deterministic board and replays them, so the stored longest-combo
    score can't be inflated. Only a fully cleared board is accepted.
    """
    payload = request.get_json(silent=True) or {}
    identity = verify_optional_friends_family_identity(payload)
    if payload.get("friendsFamilyToken") and identity is None:
        return jsonify({"error": "Session is active elsewhere"}), 409

    try:
        puzzle_date = resolve_playable_multigame_date("tiles", payload.get("date"))
        palette = resolve_default_palette(puzzle_date)
        board = generate_board(puzzle_date, palette)
        summary = simulate_moves(board, payload.get("moves"))
        if not summary["solved"]:
            raise ValueError("Tiles board is not solved")

        summary["paletteName"] = palette["displayName"]

        result = save_multigame_result(
            identity=identity,
            game_key="tiles",
            puzzle_date=puzzle_date.isoformat(),
            puzzle_variant=str(payload.get("variant") or "daily"),
            outcome="won",
            elapsed_seconds=None,
            score=summary,
        )
        return jsonify({"ok": True, "score": summary, **result})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503


@api.post("/games/crossword/check")
def multigame_crossword_check():
    """Per-cell correctness for a submitted crossword grid.

    Backs Check Square/Word/Puzzle and autocheck without ever revealing the
    answers — the client sends its current letters and gets back which filled
    cells are right or wrong.
    """
    payload = request.get_json(silent=True) or {}

    try:
        puzzle_date = resolve_playable_multigame_date("crossword", payload.get("date"))
        return jsonify(check_crossword(puzzle_date, payload.get("entries")))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503


@api.post("/games/crossword/reveal")
def multigame_crossword_reveal():
    payload = request.get_json(silent=True) or {}

    try:
        puzzle_date = resolve_playable_multigame_date("crossword", payload.get("date"))
        puzzle = get_crossword_puzzle(puzzle_date)
        return jsonify(public_crossword_solution(puzzle))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503


@api.post("/games/pips/reveal")
def multigame_pips_reveal():
    """The constructor's domino placements — for Reveal and completed-board reload."""
    payload = request.get_json(silent=True) or {}

    try:
        puzzle_date = resolve_playable_multigame_date("pips", payload.get("date"))
        puzzle = get_pips_puzzle(puzzle_date, str(payload.get("difficulty") or "easy"))
        return jsonify(public_pips_solution(puzzle))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503


@api.post("/games/mini/check")
def multigame_mini_check():
    """Per-cell correctness for a submitted Mini grid (answers never leak)."""
    payload = request.get_json(silent=True) or {}

    try:
        puzzle_date = resolve_playable_multigame_date("mini", payload.get("date"))
        return jsonify(check_mini(puzzle_date, payload.get("entries")))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503


@api.post("/games/mini/reveal")
def multigame_mini_reveal():
    payload = request.get_json(silent=True) or {}

    try:
        puzzle_date = resolve_playable_multigame_date("mini", payload.get("date"))
        puzzle = get_mini_puzzle(puzzle_date)
        return jsonify(public_mini_solution(puzzle))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503


@api.post("/games/midi/check")
def multigame_midi_check():
    """Per-cell correctness for a submitted Midi grid (answers never leak)."""
    payload = request.get_json(silent=True) or {}

    try:
        puzzle_date = resolve_playable_multigame_date("midi", payload.get("date"))
        return jsonify(check_midi(puzzle_date, payload.get("entries")))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503


@api.post("/games/midi/reveal")
def multigame_midi_reveal():
    payload = request.get_json(silent=True) or {}

    try:
        puzzle_date = resolve_playable_multigame_date("midi", payload.get("date"))
        puzzle = get_midi_puzzle(puzzle_date)
        return jsonify(public_midi_solution(puzzle))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503


@api.post("/games/strands/guess")
def multigame_strands_guess():
    payload = request.get_json(silent=True) or {}

    try:
        puzzle_date = resolve_playable_multigame_date("strands", payload.get("date"))
        return jsonify(check_strands_guess(puzzle_date, payload.get("path")))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503


@api.post("/games/strands/reveal")
def multigame_strands_reveal():
    payload = request.get_json(silent=True) or {}

    try:
        puzzle_date = resolve_playable_multigame_date("strands", payload.get("date"))
        puzzle = get_strands_puzzle(puzzle_date)
        return jsonify(public_strands_solution(puzzle))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503


@api.post("/games/strands/hint")
def multigame_strands_hint():
    payload = request.get_json(silent=True) or {}

    try:
        puzzle_date = resolve_playable_multigame_date("strands", payload.get("date"))
        return jsonify(get_strands_hint(puzzle_date, payload.get("foundThemeWords")))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503


@api.post("/games/sudoku/check")
def multigame_sudoku_check():
    payload = request.get_json(silent=True) or {}

    try:
        puzzle_date = resolve_playable_multigame_date("sudoku", payload.get("date"))
        return jsonify(
            validate_sudoku_grid(
                puzzle_date,
                str(payload.get("difficulty") or "medium"),
                payload.get("grid"),
            )
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503


@api.post("/games/sudoku/hint")
def multigame_sudoku_hint():
    payload = request.get_json(silent=True) or {}

    try:
        puzzle_date = resolve_playable_multigame_date("sudoku", payload.get("date"))
        return jsonify(
            get_sudoku_hint(
                puzzle_date,
                str(payload.get("difficulty") or "medium"),
                payload.get("cell"),
            )
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503


@api.post("/games/status")
def multigame_status():
    payload = request.get_json(silent=True) or {}
    identity = verify_optional_friends_family_identity(payload)
    if payload.get("friendsFamilyToken") and identity is None:
        return jsonify({"error": "Session is active elsewhere"}), 409

    try:
        game_key = str(payload.get("gameKey") or "")
        if not game_key or game_key not in GAME_KEYS:
            return jsonify({"error": "Invalid game"}), 400

        puzzle_date = resolve_playable_multigame_date(game_key, payload.get("date")).isoformat()
        puzzle_variant = str(payload.get("variant") or "daily")

        result = None
        attempt = None
        completed = False

        if identity is not None:
            user_id = identity["userId"]
            result = get_multigame_result_for_user(
                user_id=user_id,
                game_key=game_key,
                puzzle_date=puzzle_date,
                puzzle_variant=puzzle_variant,
            )
            completed = result is not None
            if not completed:
                attempt = get_multigame_attempt(
                    user_id=user_id,
                    game_key=game_key,
                    puzzle_date=puzzle_date,
                    puzzle_variant=puzzle_variant,
                )

        return jsonify({
            "completed": completed,
            "result": result,
            "attempt": attempt,
        })
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503


@api.post("/games/attempt")
def multigame_attempt():
    payload = request.get_json(silent=True) or {}
    identity = verify_optional_friends_family_identity(payload)
    if payload.get("friendsFamilyToken") and identity is None:
        return jsonify({"error": "Session is active elsewhere"}), 409

    if identity is None:
        return jsonify({"error": "Friends and family sign-in required"}), 401

    try:
        game_key = str(payload.get("gameKey") or "")
        if not game_key or game_key not in GAME_KEYS:
            return jsonify({"error": "Invalid game"}), 400

        puzzle_date = resolve_playable_multigame_date(game_key, payload.get("date")).isoformat()
        puzzle_variant = str(payload.get("variant") or "daily")
        state = payload.get("state")

        if not isinstance(state, dict):
            return jsonify({"error": "State must be an object"}), 400

        user_id = identity["userId"]
        existing_result = get_multigame_result_for_user(
            user_id=user_id,
            game_key=game_key,
            puzzle_date=puzzle_date,
            puzzle_variant=puzzle_variant,
        )
        if existing_result is not None:
            return jsonify({"error": "Already completed today"}), 409

        save_multigame_attempt(
            user_id=user_id,
            game_key=game_key,
            puzzle_date=puzzle_date,
            puzzle_variant=puzzle_variant,
            state=state,
        )
        return jsonify({"ok": True})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503


@api.post("/games/result")
def multigame_result():
    payload = request.get_json(silent=True) or {}
    identity = verify_optional_friends_family_identity(payload)
    if payload.get("friendsFamilyToken") and identity is None:
        return jsonify({"error": "Session is active elsewhere"}), 409

    try:
        game_key = str(payload.get("gameKey") or "")
        if game_key not in GAME_KEYS:
            return jsonify({"error": "Invalid game"}), 400

        puzzle_date = resolve_playable_multigame_date(game_key, payload.get("date"))
        validate_multigame_result_payload(game_key, puzzle_date, payload)
        if game_key == "letterboxed":
            # Replayable: keep the best solve and lock only on reveal (see the
            # upsert), rather than freezing the first result like other games.
            if identity is None:
                result = {"created": False, "result": None}
            else:
                user_id = identity.get("userId")
                if not user_id:
                    raise ValueError("Friends and family sign-in required")
                letterboxed_result = upsert_letterboxed_result(
                    user_id=user_id,
                    puzzle_date=puzzle_date.isoformat(),
                    puzzle_variant=str(payload.get("variant") or "daily"),
                    outcome=str(payload.get("outcome") or ""),
                    score=storable_multigame_score(game_key, payload.get("score")),
                )
                result = {"created": letterboxed_result is not None, "result": letterboxed_result}
        else:
            result = save_multigame_result(
                identity=identity,
                game_key=game_key,
                puzzle_date=puzzle_date.isoformat(),
                puzzle_variant=str(payload.get("variant") or "daily"),
                outcome=str(payload.get("outcome") or ""),
                elapsed_seconds=normalize_elapsed_seconds(payload.get("elapsedSeconds")),
                score=storable_multigame_score(game_key, payload.get("score")),
            )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503

    return jsonify({"ok": True, **result})


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


@api.post("/friends-family/calendar")
def friends_family_calendar():
    payload = request.get_json(silent=True) or {}
    identity = verify_friends_family_token(
        payload.get("token"),
        client_session_id=payload.get("clientSessionId"),
    )

    if identity is None:
        return jsonify({"error": "Session is active elsewhere"}), 409

    game_key = str(payload.get("gameKey") or "wordle")
    target_user_id = str(payload.get("userId") or identity["userId"]) or identity["userId"]
    current_puzzle_date = get_puzzle_date().isoformat()

    try:
        if game_key == "wordle":
            calendar = get_family_calendar(
                requesting_user_id=identity["userId"],
                target_user_id=target_user_id,
                current_puzzle_date=current_puzzle_date,
            )
        elif game_key in GAME_KEYS:
            calendar = get_multigame_calendar(
                requesting_user_id=identity["userId"],
                target_user_id=target_user_id,
                game_key=game_key,
                current_puzzle_date=current_puzzle_date,
            )
        else:
            return jsonify({"error": "Invalid game"}), 400
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    return jsonify(calendar)


@api.post("/friends-family/game-stats")
def friends_family_game_stats():
    payload = request.get_json(silent=True) or {}
    identity = verify_friends_family_token(
        payload.get("token"),
        client_session_id=payload.get("clientSessionId"),
    )

    if identity is None:
        return jsonify({"error": "Session is active elsewhere"}), 409

    return jsonify(get_multigame_dashboard(requesting_user_id=identity["userId"]))


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


@api.post("/hint")
def hint():
    """Repeated-letter hint for the current Wordle answer.

    Returns only the anonymized repeat structure (e.g. [3, 2] for MAMMA) so the
    player learns how letters repeat without learning which letters they are.
    Hint usage is logged with the completed result via /results (usedHint).
    """
    payload = request.get_json(silent=True) or {}

    try:
        answer_record = get_answer_record_for_payload(payload)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503

    return jsonify({"repeats": get_answer_repeats(answer_record["answer"])})


@api.post("/results")
def results():
    payload = request.get_json(silent=True) or {}
    friends_family_token = payload.get("friendsFamilyToken")
    friends_family_identity = None

    try:
        puzzle_mode = get_payload_mode(payload)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    if puzzle_mode in {"daily", "past"} and friends_family_token:
        friends_family_identity = verify_friends_family_token(
            friends_family_token,
            client_session_id=payload.get("clientSessionId"),
        )
        if friends_family_identity is None:
            return jsonify({"error": "Session is active elsewhere"}), 409

    used_hint = bool(payload.get("usedHint"))

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
                used_hint=used_hint,
            )
        else:
            # Past (archive) plays are recorded for the calendar but never tracked
            # in stats; random plays are not dated puzzles, so they stay untracked.
            if puzzle_mode == "past" and friends_family_identity is not None:
                record_retro_family_result(
                    user_id=friends_family_identity["userId"],
                    puzzle_date=answer_record["puzzle_date"],
                    answer=answer_record["answer"],
                    outcome=str(payload.get("outcome") or ""),
                    guesses_used=int(payload.get("guessesUsed") or 0),
                    board=payload.get("board"),
                    guesses=payload.get("guesses"),
                    used_hint=used_hint,
                )
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


def normalize_contact_message(raw_message: object) -> str | None:
    if not isinstance(raw_message, str):
        return None

    message = raw_message.strip()
    if not message:
        return None

    return message[:2000]


def get_contact_identity(payload: dict) -> dict[str, str] | None:
    identity = verify_friends_family_token(
        payload.get("friendsFamilyToken"),
        client_session_id=payload.get("clientSessionId"),
    )

    if identity is None:
        return None

    return {
        "firstName": identity["firstName"],
        "lastInitial": identity["lastInitial"],
    }


def verify_optional_friends_family_identity(payload: dict) -> dict[str, str] | None:
    token = payload.get("friendsFamilyToken")
    if not token:
        return None

    return verify_friends_family_token(
        token,
        client_session_id=payload.get("clientSessionId"),
    )


def resolve_playable_multigame_date(game_key: str, raw_date: object) -> date:
    resolved_date, _clamp_info = resolve_multigame_date(game_key, get_puzzle_date(raw_date))
    return resolved_date


def storable_multigame_score(game_key: str, raw_score: object) -> dict:
    """Strip fields that are identical for everyone who plays a given day.

    A solved daily grid/path is the same for every solver, so we don't store it;
    we keep only what differs between players (guess order, found words, mistakes,
    hints). The stripped fields are still used for server-side win validation.
    """
    score = raw_score if isinstance(raw_score, dict) else {}
    fields_to_drop = {
        "sudoku": {"grid"},
        "strands": {"foundPaths"},
        "crossword": {"entries"},
        "mini": {"entries"},
        "midi": {"entries"},
        "pips": {"placements"},
    }.get(game_key, set())
    return {key: value for key, value in score.items() if key not in fields_to_drop}


def validate_multigame_result_payload(game_key: str, puzzle_date: date, payload: dict) -> None:
    if game_key not in GAME_KEYS:
        raise ValueError("Invalid game")

    outcome = payload.get("outcome")
    if outcome not in {"won", "lost"}:
        raise ValueError("Invalid outcome")

    score = payload.get("score")
    if not isinstance(score, dict):
        raise ValueError("Invalid score")

    if game_key == "sudoku":
        sudoku_status = validate_sudoku_grid(
            puzzle_date,
            str(payload.get("variant") or "medium"),
            score.get("grid"),
        )
        if outcome == "won" and not sudoku_status["solved"]:
            raise ValueError("Sudoku is not solved")
        return

    if game_key == "letterboxed":
        if outcome == "won" and not validate_letterboxed_solution(puzzle_date, score.get("words")):
            raise ValueError("Letter Boxed is not solved")
        return

    if game_key == "crossword":
        if outcome == "won" and not validate_crossword_solution(puzzle_date, score.get("entries")):
            raise ValueError("Crossword is not solved")
        return

    if game_key == "mini":
        if outcome == "won" and not validate_mini_solution(puzzle_date, score.get("entries")):
            raise ValueError("Mini is not solved")
        return

    if game_key == "midi":
        if outcome == "won" and not validate_midi_solution(puzzle_date, score.get("entries")):
            raise ValueError("Midi is not solved")
        return

    if game_key == "pips":
        if outcome == "won" and not validate_pips_solution(
            puzzle_date,
            str(payload.get("variant") or "easy"),
            score.get("placements"),
        ):
            raise ValueError("Pips is not solved")
        return

    if game_key == "connections":
        puzzle = get_connections_puzzle(puzzle_date)
        solved_groups = score.get("solvedGroups")
        if not isinstance(solved_groups, list):
            raise ValueError("Invalid Connections score")
        solved_titles = {
            str(group.get("title") or "").strip().upper()
            for group in solved_groups
            if isinstance(group, dict)
        }
        expected_titles = {
            group["title"].upper() for group in public_connections_solution(puzzle)
        }
        if outcome == "won" and solved_titles != expected_titles:
            raise ValueError("Connections is not solved")
        return

    if game_key == "strands":
        puzzle = get_strands_puzzle(puzzle_date)
        solution = public_strands_solution(puzzle)
        found_theme_words = score.get("foundThemeWords")
        found_spangram = score.get("foundSpangram")
        if not isinstance(found_theme_words, list):
            raise ValueError("Invalid Strands score")
        normalized_found_theme_words = {
            str(word).strip().upper()
            for word in found_theme_words
            if isinstance(word, str)
        }
        if outcome == "won" and (
            normalized_found_theme_words != set(solution["themeWords"])
            or found_spangram is not True
        ):
            raise ValueError("Strands is not solved")


def normalize_elapsed_seconds(raw_elapsed_seconds: object) -> int | None:
    if raw_elapsed_seconds is None:
        return None

    try:
        elapsed_seconds = int(raw_elapsed_seconds)
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid elapsed time") from exc

    if elapsed_seconds < 0 or elapsed_seconds > 24 * 60 * 60:
        raise ValueError("Invalid elapsed time")

    return elapsed_seconds


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
