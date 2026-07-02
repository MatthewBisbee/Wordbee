from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
from datetime import UTC, datetime
from typing import Any


CODE_ENV_KEY = "WORDBEE_FRIENDS_FAMILY_CODES"
TOKEN_KIND = "friends-family"
TOKEN_VERSION = 1
FIRST_NAME_PATTERN = re.compile(r"^[A-Za-z][A-Za-z' -]{0,39}$")
CODE_ID_PATTERN = re.compile(r"[^A-Za-z0-9_-]+")


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
) -> dict[str, Any]:
    configured_code = validate_friends_family_code(code)
    if configured_code is None:
        raise ValueError("Code not recognized")

    normalized_first_name = normalize_first_name(first_name)
    normalized_last_initial = normalize_last_initial(last_initial)
    identity = create_identity(normalized_first_name, normalized_last_initial)
    payload = {
        "kind": TOKEN_KIND,
        "version": TOKEN_VERSION,
        "codeId": configured_code["codeId"],
        "firstName": identity["firstName"],
        "lastInitial": identity["lastInitial"],
        "issuedAt": datetime.now(UTC).isoformat(timespec="seconds"),
    }

    return {
        "identity": identity,
        "token": encode_token(payload),
    }


def verify_friends_family_token(raw_token: object) -> dict[str, str] | None:
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

    return create_identity(first_name, last_initial)


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
