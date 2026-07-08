from __future__ import annotations

import os
import threading
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from flask import Flask, jsonify, request
from werkzeug.exceptions import HTTPException

from .config import load_env_file
from .daily_answer import get_puzzle_date, get_puzzle_timezone_name
from .db import init_db
from .games.registry import warm_all_games
from .routes import api


TRUTHY_VALUES = {"1", "true", "yes", "on"}
_multigame_warmup_thread_started = False


def create_app() -> Flask:
    global _multigame_warmup_thread_started

    load_env_file()

    app = Flask(__name__)
    init_db()
    app.register_blueprint(api, url_prefix="/api")
    if is_multigame_warmup_enabled() and not _multigame_warmup_thread_started:
        _multigame_warmup_thread_started = True
        start_multigame_warmup_thread(app)

    @app.errorhandler(Exception)
    def handle_api_error(error):
        if isinstance(error, HTTPException):
            return jsonify({"error": error.description or error.name}), error.code

        app.logger.exception("Unhandled API error")
        return jsonify({"error": "Internal API error"}), 500

    @app.after_request
    def add_api_headers(response):
        if request.path.startswith("/api/"):
            response.headers["Access-Control-Allow-Origin"] = "*"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type"
            response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
        if request.path == "/api/today" or (
            request.path.startswith("/api/games/") and request.path.endswith("/today")
        ):
            response.headers["Cache-Control"] = "no-store, max-age=0"
            response.headers["Pragma"] = "no-cache"
        return response

    return app


def is_multigame_warmup_enabled() -> bool:
    return os.environ.get("WORDBEE_MULTIGAME_WARMUP_ENABLED", "1").lower() in TRUTHY_VALUES


def start_multigame_warmup_thread(app: Flask) -> None:
    thread = threading.Thread(
        target=run_multigame_warmup_loop,
        args=(app,),
        daemon=True,
        name="wordbee-multigame-warmup",
    )
    thread.start()


def run_multigame_warmup_loop(app: Flask) -> None:
    retry_seconds = get_warmup_retry_seconds()

    while True:
        target_date = get_puzzle_date()
        try:
            result = warm_all_games(target_date)
            if result["confirmed"]:
                app.logger.info("Confirmed non-Wordle daily puzzles for %s", result["date"])
                time.sleep(seconds_until_next_puzzle_date())
                continue

            app.logger.warning("Non-Wordle daily warmup incomplete: %s", result)
        except Exception:
            app.logger.exception("Non-Wordle daily warmup failed")

        time.sleep(retry_seconds)


def get_warmup_retry_seconds() -> int:
    raw_value = os.environ.get("WORDBEE_MULTIGAME_WARMUP_RETRY_SECONDS", "300")
    try:
        retry_seconds = int(raw_value)
    except ValueError:
        return 300

    return min(max(retry_seconds, 30), 60 * 60)


def seconds_until_next_puzzle_date(now: datetime | None = None) -> float:
    timezone = ZoneInfo(get_puzzle_timezone_name())
    current_time = now or datetime.now(timezone)
    if current_time.tzinfo is None:
        current_time = current_time.replace(tzinfo=timezone)

    local_time = current_time.astimezone(timezone)
    next_midnight = datetime.combine(
        local_time.date() + timedelta(days=1),
        datetime.min.time(),
        timezone,
    )
    return max(30.0, (next_midnight - local_time).total_seconds())
