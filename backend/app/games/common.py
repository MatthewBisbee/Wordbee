from __future__ import annotations

from typing import Any

import requests


SOURCE_TIMEOUT_SECONDS = 8


PUBLISHER_BASE_URL = "https://www.nytimes.com/svc"


SUDOKU_PAGE_URL = "https://www.nytimes.com/puzzles/sudoku"


WAYBACK_AVAILABLE_URL = "https://archive.org/wayback/available"


USER_AGENT = "Wordbee/0.1 (+https://github.com/MatthewBisbee/Wordbee)"


def fetch_json(url: str) -> dict[str, Any]:
    response = requests.get(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=SOURCE_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError("Publisher response was not an object")
    return payload


def normalize_text(raw_value: object, *, max_length: int) -> str:
    if not isinstance(raw_value, str):
        return ""

    return " ".join(raw_value.strip().split())[:max_length]
