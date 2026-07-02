from __future__ import annotations

from flask import Flask, jsonify, request
from werkzeug.exceptions import HTTPException

from .config import load_env_file
from .db import init_db
from .routes import api


def create_app() -> Flask:
    load_env_file()

    app = Flask(__name__)
    init_db()
    app.register_blueprint(api, url_prefix="/api")

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
        return response

    return app
