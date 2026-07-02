from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
from datetime import UTC, datetime
from typing import Any

from .db import connect


CODE_ENV_KEY = "WORDBEE_FRIENDS_FAMILY_CODES"
TOKEN_KIND = "friends-family"
TOKEN_VERSION = 2
FIRST_NAME_PATTERN = re.compile(r"^[A-Za-z][A-Za-z' -]{0,39}$")
CODE_ID_PATTERN = re.compile(r"[^A-Za-z0-9_-]+")
CLIENT_SESSION_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,96}$")


def validate_friends_family_code(raw_code: object) -> dict[str, str] | None:
    submitted_code = normalize_code(raw_code)
    if not submitted_code:
        return None

    for configured_code in get_configured_codes():
        if hmac.compare_digest(configured_code["code"], submitted_code):
            return {"codeId": configured_code["codeId"]}

    return None


def create_friends_family_session(
    *,
    code: object,
    first_name: object,
    last_initial: object,
    client_session_id: object = None,
) -> dict[str, Any]:
    configured_code = validate_friends_family_code(code)
    if configured_code is None:
        raise ValueError("Code not recognized")

    normalized_first_name = normalize_first_name(first_name)
    normalized_last_initial = normalize_last_initial(last_initial)
    normalized_client_session_id = normalize_client_session_id(client_session_id)
    code_id = configured_code["codeId"]
    user = upsert_friends_family_user(
        code_id=code_id,
        first_name=normalized_first_name,
        last_initial=normalized_last_initial,
        client_session_id=normalized_client_session_id,
    )
    payload = {
        "kind": TOKEN_KIND,
        "version": TOKEN_VERSION,
        "codeId": code_id,
        "userId": user["userId"],
        "sessionId": user["sessionId"],
        "firstName": user["firstName"],
        "lastInitial": user["lastInitial"],
        "issuedAt": datetime.now(UTC).isoformat(timespec="seconds"),
    }

    return {
        "identity": public_identity(user),
        "token": encode_token(payload),
    }


def verify_friends_family_token(
    raw_token: object,
    *,
    client_session_id: object = None,
    claim_client_session: bool = False,
) -> dict[str, str] | None:
    if not isinstance(raw_token, str) or "." not in raw_token:
        return None

    encoded_payload, encoded_signature = raw_token.split(".", 1)
    expected_signature = sign_payload(encoded_payload)
    if not hmac.compare_digest(expected_signature, encoded_signature):
        return None

    try:
        payload = json.loads(decode_base64_url(encoded_payload))
    except (ValueError, json.JSONDecodeError):
        return None

    if payload.get("kind") != TOKEN_KIND or payload.get("version") != TOKEN_VERSION:
        return None

    configured_code_ids = {configured_code["codeId"] for configured_code in get_configured_codes()}
    if payload.get("codeId") not in configured_code_ids:
        return None

    try:
        first_name = normalize_first_name(payload.get("firstName"))
        last_initial = normalize_last_initial(payload.get("lastInitial"))
    except ValueError:
        return None

    user_id = payload.get("userId")
    session_id = payload.get("sessionId")
    if not isinstance(user_id, str) or not isinstance(session_id, str):
        return None

    normalized_client_session_id = normalize_client_session_id(client_session_id)

    with connect() as connection:
        user_row = connection.execute(
            """
            SELECT id, code_id, first_name, last_initial, display_name,
                   active_session_id, active_client_session_id
            FROM friends_family_users
            WHERE id = ?
            """,
            (user_id,),
        ).fetchone()

        if user_row is None:
            return None

        if user_row["active_session_id"] != session_id:
            return None

        if user_row["code_id"] != payload.get("codeId"):
            return None

        if user_row["first_name"] != first_name or user_row["last_initial"] != last_initial:
            return None

        active_client_session_id = user_row["active_client_session_id"]
        if normalized_client_session_id:
            now = datetime.now(UTC).isoformat(timespec="seconds")

            if claim_client_session:
                connection.execute(
                    """
                    UPDATE friends_family_users
                    SET active_client_session_id = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (normalized_client_session_id, now, user_id),
                )
                active_client_session_id = normalized_client_session_id
            elif active_client_session_id and active_client_session_id != normalized_client_session_id:
                return None

            connection.execute(
                """
                UPDATE friends_family_sessions
                SET client_session_id = ?, last_seen_at = ?
                WHERE id = ?
                """,
                (normalized_client_session_id, now, session_id),
            )

    return {
        "kind": TOKEN_KIND,
        "userId": user_row["id"],
        "codeId": user_row["code_id"],
        "displayName": user_row["display_name"],
        "firstName": user_row["first_name"],
        "lastInitial": user_row["last_initial"],
    }


def sign_out_friends_family_session(
    raw_token: object,
    *,
    client_session_id: object = None,
) -> bool:
    identity = verify_friends_family_token(
        raw_token,
        client_session_id=client_session_id,
        claim_client_session=False,
    )
    if identity is None:
        return False

    with connect() as connection:
        connection.execute(
            """
            UPDATE friends_family_users
            SET active_session_id = NULL,
                active_client_session_id = NULL,
                updated_at = ?
            WHERE id = ?
            """,
            (datetime.now(UTC).isoformat(timespec="seconds"), identity["userId"]),
        )

    return True


def get_configured_codes() -> list[dict[str, str]]:
    configured_codes = []

    for index, raw_entry in enumerate(os.environ.get(CODE_ENV_KEY, "").split(",")):
        entry = raw_entry.strip()
        if not entry:
            continue

        if ":" in entry:
            raw_code_id, raw_code = entry.split(":", 1)
        else:
            raw_code_id = f"group-{index + 1}"
            raw_code = entry

        code = normalize_code(raw_code)
        if not code:
            continue

        configured_codes.append(
            {
                "code": code,
                "codeId": normalize_code_id(raw_code_id, index),
            }
        )

    return configured_codes


def create_identity(first_name: str, last_initial: str) -> dict[str, str]:
    return {
        "kind": TOKEN_KIND,
        "displayName": f"{first_name} {last_initial}",
        "firstName": first_name,
        "lastInitial": last_initial,
    }


def normalize_code(raw_code: object) -> str:
    if not isinstance(raw_code, str):
        return ""

    return raw_code.strip()


def normalize_client_session_id(raw_client_session_id: object) -> str:
    if not isinstance(raw_client_session_id, str):
        return ""

    client_session_id = raw_client_session_id.strip()
    if not CLIENT_SESSION_PATTERN.fullmatch(client_session_id):
        return ""

    return client_session_id


def normalize_code_id(raw_code_id: str, index: int) -> str:
    code_id = CODE_ID_PATTERN.sub("-", raw_code_id.strip()).strip("-").lower()
    return (code_id or f"group-{index + 1}")[:48]


def normalize_first_name(raw_first_name: object) -> str:
    if not isinstance(raw_first_name, str):
        raise ValueError("Enter a first name")

    first_name = " ".join(raw_first_name.strip().split())
    if not FIRST_NAME_PATTERN.fullmatch(first_name):
        raise ValueError("Enter a first name")

    return " ".join(capitalize_name_part(name_part) for name_part in first_name.split(" "))


def normalize_last_initial(raw_last_initial: object) -> str:
    if not isinstance(raw_last_initial, str):
        raise ValueError("Enter a last initial")

    last_initial = raw_last_initial.strip()
    if len(last_initial) != 1 or not last_initial.isalpha():
        raise ValueError("Enter one last initial")

    return last_initial.upper()


def upsert_friends_family_user(
    *,
    code_id: str,
    first_name: str,
    last_initial: str,
    client_session_id: str,
) -> dict[str, str]:
    user_id = create_user_id(code_id, first_name, last_initial)
    session_id = create_session_id()
    display_name = f"{first_name} {last_initial}"
    now = datetime.now(UTC).isoformat(timespec="seconds")

    with connect() as connection:
        connection.execute(
            """
            INSERT INTO friends_family_users (
              id, code_id, first_name, last_initial, display_name,
              active_session_id, active_client_session_id, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              display_name = excluded.display_name,
              active_session_id = excluded.active_session_id,
              active_client_session_id = excluded.active_client_session_id,
              updated_at = excluded.updated_at
            """,
            (
                user_id,
                code_id,
                first_name,
                last_initial,
                display_name,
                session_id,
                client_session_id,
                now,
                now,
            ),
        )
        connection.execute(
            """
            INSERT INTO friends_family_sessions (
              id, user_id, client_session_id, created_at, last_seen_at
            )
            VALUES (?, ?, ?, ?, ?)
            """,
            (session_id, user_id, client_session_id, now, now),
        )

    return {
        "kind": TOKEN_KIND,
        "userId": user_id,
        "codeId": code_id,
        "sessionId": session_id,
        "displayName": display_name,
        "firstName": first_name,
        "lastInitial": last_initial,
    }


def public_identity(user: dict[str, str]) -> dict[str, str]:
    return {
        "kind": TOKEN_KIND,
        "userId": user["userId"],
        "displayName": user["displayName"],
        "firstName": user["firstName"],
        "lastInitial": user["lastInitial"],
    }


def create_user_id(code_id: str, first_name: str, last_initial: str) -> str:
    raw_id = f"{code_id}:{first_name.lower()}:{last_initial.upper()}"
    return hashlib.sha256(raw_id.encode("utf-8")).hexdigest()[:32]


def create_session_id() -> str:
    return secrets.token_urlsafe(24)


def capitalize_name_part(name_part: str) -> str:
    return "-".join(capitalize_apostrophe_part(part) for part in name_part.split("-"))


def capitalize_apostrophe_part(name_part: str) -> str:
    return "'".join(part[:1].upper() + part[1:] for part in name_part.split("'"))


def encode_token(payload: dict[str, Any]) -> str:
    encoded_payload = encode_base64_url(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    return f"{encoded_payload}.{sign_payload(encoded_payload)}"


def sign_payload(encoded_payload: str) -> str:
    digest = hmac.new(
        get_secret_key().encode("utf-8"),
        encoded_payload.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return encode_base64_url(digest)


def get_secret_key() -> str:
    secret_key = os.environ.get("SECRET_KEY", "").strip()
    if not secret_key or secret_key == "replace_me":
        return "wordbee-development-secret"

    return secret_key


def encode_base64_url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def decode_base64_url(value: str) -> str:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(f"{value}{padding}").decode("utf-8")
