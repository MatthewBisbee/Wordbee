from __future__ import annotations

from flask import Blueprint, jsonify, request

from .daily_answer import get_daily_answer, get_puzzle_date
from .game import is_valid_guess, normalize_guess, score_guess


api = Blueprint("api", __name__)


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


@api.post("/guess")
def guess():
    payload = request.get_json(silent=True) or {}

    try:
        puzzle_date = get_puzzle_date(payload.get("date"))
        answer_record = get_daily_answer(puzzle_date)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503

    normalized_guess = normalize_guess(payload.get("guess"), answer_record["answer_length"])
    if normalized_guess is None:
        return jsonify({"error": "Guess must be five letters"}), 400

    if not is_valid_guess(normalized_guess, answer_record["answer"]):
        return jsonify({"error": "Not in word list"}), 400

    scores = score_guess(answer_record["answer"], normalized_guess)
    did_win = all(score == "correct" for score in scores)
    should_reveal = bool(payload.get("reveal"))

    response = {
        "date": answer_record["puzzle_date"],
        "scores": scores,
        "didWin": did_win,
    }

    if should_reveal:
        response["answer"] = answer_record["answer"]

    return jsonify(response)


def public_sources(sources):
    return [
        {key: value for key, value in source.items() if key != "answer"}
        for source in sources
    ]
