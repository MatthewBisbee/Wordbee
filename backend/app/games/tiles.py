"""NYT Tiles board generation + art-palette pipeline.

Tiles is structurally different from every other game in the suite. NYT's own
client generates the board with ``Math.random`` at play time (verified in
``tiles.*.js``): a board is 30 tiles, each stacking a background plus four
decorative layers (A/B/C/D), and every layer's variants are laid down in pairs
so the board is always clearable. The *only* daily/rotating element is the art
**palette** — a set of SVG ``<symbol>`` definitions plus three theme colours,
commissioned per designer (e.g. "brighton" by Robert Vinluan). Switching palette
in NYT is a pure re-skin: the same board renders under any palette, which proves
every palette shares one canonical layer structure (Z:3, A:9, B:12, C:12, D:12).

We keep the mechanic faithful but make the board a *shared daily*: it is
generated deterministically from the date (seeded RNG mirroring NYT's algorithm)
so the whole family plays the same solvable board and longest-combo scores are
comparable. A "Zen" mode (random board, untracked) is offered client-side, like
NYT's zen mode. The palette is a cosmetic overlay resolved per date from the
captured art, with a switcher exactly like NYT's.

Sourcing: Tiles is a subscriber-only game, so an anonymous request to the live
page only ever yields the default palette ("brighton"); the other palettes'
full art requires an authenticated session (``NYT_COOKIE``) and are captured by
``scripts/tiles_backfill.py`` on the operator's own machine. The real brighton
palette is bundled so the game is fully playable out of the box.
"""
from __future__ import annotations

import json
import os
import random
import re
from datetime import date, datetime
from html import unescape
from pathlib import Path
from typing import Any

import requests

from ..daily_answer import get_puzzle_date
from .common import SOURCE_TIMEOUT_SECONDS, USER_AGENT, normalize_text
from .tiles_db import connect_tiles


TILES_PAGE_URL = "https://www.nytimes.com/puzzles/tiles"
TILES_FIRST_DATE = date(2023, 4, 24)

# The board is a 5-wide, 6-tall grid (30 tiles), matching NYT's layout.
BOARD_COLS = 5
BOARD_ROWS = 6
BOARD_SIZE = BOARD_COLS * BOARD_ROWS

# The canonical layer structure shared by every NYT Tiles palette (see module
# docstring): a background layer Z with three variants, and four decorative
# layers A/B/C/D with 9/12/12/12 variants. Board ids reference these directly, so
# any palette's art can render any board.
CANONICAL_Z = ["Z1", "Z2", "Z3"]
CANONICAL_LAYERS = [
    [f"A{i}" for i in range(1, 10)],
    [f"B{i}" for i in range(1, 13)],
    [f"C{i}" for i in range(1, 13)],
    [f"D{i}" for i in range(1, 13)],
]
LAYER_COUNT = len(CANONICAL_LAYERS)

# The full NYT palette catalogue, in a fixed order so the per-date default
# rotates deterministically regardless of how many palettes have been captured.
PALETTE_ORDER = [
    "austin",
    "brighton",
    "granada",
    "holland",
    "hong-kong",
    "kuala-lumpur",
    "lisbon",
    "los-angeles",
    "new-haven",
    "paris",
    "soho",
    "tangier",
    "topeka",
    "utrecht",
]


_FALLBACK_PATH = Path(__file__).with_name("tiles_fallback.json")


# --- Public entry points ----------------------------------------------------


def get_tiles_puzzle(puzzle_date: date, *, force_refresh: bool = False) -> dict[str, Any]:
    """The full day's puzzle: the deterministic board plus its resolved palette.

    The board is generated locally (no network); only the palette art may need a
    fetch, and even that falls back to the bundled brighton palette so a day is
    always fully playable offline.
    """
    palette = resolve_default_palette(puzzle_date, force_refresh=force_refresh)
    board = generate_board(puzzle_date, palette)
    return {
        "date": puzzle_date.isoformat(),
        "displayDate": puzzle_date.strftime("%B %-d, %Y"),
        "status": "confirmed" if palette["status"] == "confirmed" else "generated",
        "board": board,
        "rows": BOARD_ROWS,
        "cols": BOARD_COLS,
        "palette": palette,
        "palettes": list_palette_catalog(),
    }


def public_tiles_puzzle(puzzle: dict[str, Any]) -> dict[str, Any]:
    # Nothing is secret in Tiles (the board is deterministic and meant to be
    # rendered), so the public shape is the raw puzzle with the palette trimmed
    # to what the client renders.
    return {
        "gameKey": "tiles",
        "date": puzzle["date"],
        "displayDate": puzzle["displayDate"],
        "status": puzzle["status"],
        "board": puzzle["board"],
        "rows": puzzle["rows"],
        "cols": puzzle["cols"],
        # The canonical layer id lists let the client generate its own random
        # "Zen" boards (untracked) without another round-trip.
        "zLayer": puzzle["palette"]["zLayer"],
        "layers": puzzle["palette"]["layers"],
        "palette": public_palette(puzzle["palette"]),
        "palettes": puzzle["palettes"],
    }


def public_palette(palette: dict[str, Any]) -> dict[str, Any]:
    return {
        "filename": palette["filename"],
        "displayName": palette["displayName"],
        "createdBy": palette["createdBy"],
        "bgColor": palette["bgColor"],
        "fontColor": palette["fontColor"],
        "selectionColor": palette["selectionColor"],
        "zLayer": palette["zLayer"],
        "layers": palette["layers"],
        "svg": palette["svg"],
    }


def warm_tiles_puzzle(puzzle_date: date) -> dict[str, Any]:
    """Keep the day's default palette fresh (and opportunistically capture it)."""
    filename = PALETTE_ORDER[_day_index(puzzle_date) % len(PALETTE_ORDER)]
    cached = get_cached_palette(filename)
    if cached is not None and cached["status"] == "confirmed":
        return {"confirmed": True, "status": "cached", "palette": filename}

    fetched = fetch_tiles_palette(filename)
    if fetched is None:
        # The bundled brighton palette guarantees the game still renders.
        return {"confirmed": get_cached_palette("brighton") is not None, "status": "unavailable", "palette": filename}

    saved = save_palette(status="confirmed", source={"id": "publisher", "ok": True}, **fetched)
    return {"confirmed": True, "status": "fetched", "palette": saved["filename"]}


# --- Board generation -------------------------------------------------------


def generate_board(puzzle_date: date, palette: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Deterministically generate the day's solvable 30-tile board.

    Uses the resolved palette's actual Z and decorative layer variant structures
    to guarantee the board layout is correct under that palette's art symbols.
    """
    if palette is None:
        palette = resolve_default_palette(puzzle_date)
    z_layer = palette.get("zLayer") or palette.get("z_layer") or CANONICAL_Z
    layers = palette.get("layers") or palette.get("layers") or CANONICAL_LAYERS
    return _build_board(random.Random(f"tiles:{puzzle_date.isoformat()}"), z_layer, layers)


def _build_board(rng: random.Random, z_layer: list[str], layers: list[list[str]]) -> list[dict[str, Any]]:
    if len(z_layer) <= 2:
        z_pick = list(z_layer)
    else:
        rest = list(z_layer[1:])
        z_pick = [z_layer[0], rest[rng.randrange(len(rest))]]

    half = BOARD_SIZE // 2
    pools: list[list[str]] = []
    for variants in layers:
        picks = [variants[rng.randrange(len(variants))] for _ in range(half)]
        pool = picks + picks  # duplicate → even counts → always solvable
        rng.shuffle(pool)
        pools.append(pool)

    board: list[dict[str, Any]] = []
    for tile_id in range(BOARD_SIZE):
        board.append(
            {
                "id": tile_id,
                "z": z_pick[tile_id % 2],
                "layers": [pools[layer].pop() for layer in range(len(layers))],
            }
        )
    return board


# --- Move simulation & scoring ----------------------------------------------


def simulate_moves(board: list[dict[str, Any]], raw_moves: object) -> dict[str, Any]:
    """Replay a sequence of two-tile selections on a board, authoritatively.

    A move is a pair of tile indices. Layers shared at the same position (same
    id) are cleared from both tiles. A move that clears at least one layer
    extends the combo; a move that clears nothing breaks it and counts as a
    wrong move. Selecting an already-empty tile first is a "free" pick and does
    not affect the combo (matching NYT's ``scoreMove``). Returns the longest
    combo, move/wrong-move counts, whether it was a perfect solve, and whether
    the board was fully cleared.
    """
    # Mutable per-tile layer state (None = cleared at that position).
    tiles: list[list[str | None]] = [list(tile["layers"]) for tile in board]

    longest_combo = 0
    current_combo = 0
    wrong_moves = 0
    good_moves = 0

    for move in _normalize_moves(raw_moves):
        first, second = move
        if first == second or not (0 <= first < len(tiles)) or not (0 <= second < len(tiles)):
            continue
        # A free pick: the first tile is already empty, so nothing is scored.
        if all(layer is None for layer in tiles[first]):
            continue

        shared = [
            index
            for index in range(len(tiles[first]))
            if tiles[first][index] is not None and tiles[first][index] == tiles[second][index]
        ]
        if shared:
            for index in shared:
                tiles[first][index] = None
                tiles[second][index] = None
            current_combo += 1
            good_moves += 1
            longest_combo = max(longest_combo, current_combo)
        else:
            current_combo = 0
            wrong_moves += 1

    solved = all(all(layer is None for layer in tile) for tile in tiles)
    return {
        "longestCombo": longest_combo,
        "moves": good_moves + wrong_moves,
        "wrongMoves": wrong_moves,
        "perfect": solved and wrong_moves == 0,
        "solved": solved,
    }


def _normalize_moves(raw_moves: object) -> list[tuple[int, int]]:
    if not isinstance(raw_moves, list):
        return []
    moves: list[tuple[int, int]] = []
    for entry in raw_moves:
        if isinstance(entry, (list, tuple)) and len(entry) == 2:
            try:
                moves.append((int(entry[0]), int(entry[1])))
            except (TypeError, ValueError):
                continue
    return moves


# --- Palette resolution -----------------------------------------------------


def _day_index(puzzle_date: date) -> int:
    return (puzzle_date - TILES_FIRST_DATE).days


def resolve_default_palette(puzzle_date: date, *, force_refresh: bool = False) -> dict[str, Any]:
    """The day's cosmetic palette: rotate through the catalogue by date.

    If the rotated palette's art has not been captured yet (it requires a
    subscriber session), fall back to the bundled brighton palette so the board
    still renders. The board itself is palette-independent, so this only changes
    the artwork.
    """
    # Serving is local-first: only a backfill/warm pass (force_refresh) reaches
    # the network. Everyday serves resolve from the cache or the bundle.
    filename = PALETTE_ORDER[_day_index(puzzle_date) % len(PALETTE_ORDER)]
    palette = ensure_palette(filename, allow_fetch=force_refresh, force_refresh=force_refresh)
    if palette is not None:
        return palette
    brighton = ensure_palette("brighton", allow_fetch=force_refresh)
    if brighton is not None:
        return brighton
    raise RuntimeError("No Tiles palette art is available")


def ensure_palette(
    filename: str, *, allow_fetch: bool = False, force_refresh: bool = False
) -> dict[str, Any] | None:
    """Return a palette's full art from cache, the bundle, or (opt-in) the network.

    ``allow_fetch`` gates the network so ordinary serves stay fully offline once a
    palette is cached; backfill/warm passes set it (and ``force_refresh``) to
    capture or refresh the real subscriber-only art.
    """
    if not force_refresh:
        cached = get_cached_palette(filename)
        if cached is not None:
            return cached

    if allow_fetch:
        fetched = fetch_tiles_palette(filename)
        if fetched is not None:
            return save_palette(status="confirmed", source={"id": "publisher", "ok": True}, **fetched)

    cached = get_cached_palette(filename)
    if cached is not None:
        return cached

    bundled = load_fallback_palette(filename)
    if bundled is not None:
        return save_palette(status="generated", source={"id": "fallback", "ok": False}, **bundled)
    return None


def list_palette_catalog() -> list[dict[str, Any]]:
    """Metadata for every palette whose art is available, for the switcher."""
    catalog: dict[str, dict[str, Any]] = {}
    for row in list_cached_palettes():
        catalog[row["filename"]] = {
            "filename": row["filename"],
            "displayName": row["displayName"],
            "createdBy": row["createdBy"],
        }
    for palette in load_fallback_palettes():
        catalog.setdefault(
            palette["filename"],
            {
                "filename": palette["filename"],
                "displayName": palette["display_name"],
                "createdBy": palette["created_by"],
            },
        )
    order = {name: index for index, name in enumerate(PALETTE_ORDER)}
    return sorted(catalog.values(), key=lambda item: order.get(item["filename"], len(order)))


def get_tiles_palette(filename: str) -> dict[str, Any]:
    """Public art for one palette, for the client's lazy switcher fetch."""
    palette = ensure_palette(str(filename or "").strip())
    if palette is None:
        raise ValueError("Unknown palette")
    return public_palette(palette)


# --- Fetching ---------------------------------------------------------------


def fetch_tiles_palette(filename: str | None = None) -> dict[str, Any] | None:
    """Fetch one palette's art from the live NYT page.

    Anonymous requests only ever return the default (brighton) palette; the
    others need an authenticated subscriber session supplied via ``NYT_COOKIE``.
    Returns ``None`` on any failure (the caller falls back to cache/bundle).
    """
    cookie = os.environ.get("NYT_COOKIE")
    headers = {"User-Agent": USER_AGENT}
    if cookie:
        headers["Cookie"] = cookie

    try:
        if filename:
            headers["Accept"] = "application/json"
            url = f"https://www.nytimes.com/puzzles/tiles/palette/{filename}"
            response = requests.get(url, headers=headers, timeout=SOURCE_TIMEOUT_SECONDS)
            response.raise_for_status()
            game_data = response.json()
        else:
            headers["Accept"] = "text/html"
            response = requests.get(TILES_PAGE_URL, headers=headers, timeout=SOURCE_TIMEOUT_SECONDS)
            response.raise_for_status()
            game_data = extract_tiles_game_data(response.text)

        palette = normalize_palette(game_data)
    except Exception:  # noqa: BLE001 - best-effort; caller falls back
        return None

    # Anonymous requests silently return brighton no matter what was asked for;
    # only accept a fetch that actually delivered the requested palette.
    if filename and palette["filename"] != filename:
        return None
    return palette



def discover_palette_catalog() -> list[dict[str, Any]]:
    """The palette metadata NYT advertises (for backfill to iterate over)."""
    headers = {"User-Agent": USER_AGENT, "Accept": "text/html"}
    cookie = os.environ.get("NYT_COOKIE")
    if cookie:
        headers["Cookie"] = cookie
    response = requests.get(TILES_PAGE_URL, headers=headers, timeout=SOURCE_TIMEOUT_SECONDS)
    response.raise_for_status()
    game_data = extract_tiles_game_data(response.text)
    catalog = []
    for entry in game_data.get("allPalettes") or []:
        if isinstance(entry, dict) and entry.get("filename"):
            catalog.append(
                {
                    "filename": str(entry["filename"]),
                    "displayName": normalize_text(entry.get("displayName"), max_length=80),
                    "createdBy": normalize_text(entry.get("createdBy"), max_length=120),
                }
            )
    return catalog


def normalize_palette(game_data: dict[str, Any]) -> dict[str, Any]:
    filename = str(game_data.get("filename") or "").strip()
    svg = game_data.get("svg")
    layers = game_data.get("layers")
    z_layer = game_data.get("zLayer")
    if not filename or not isinstance(svg, str) or not svg:
        raise ValueError("Tiles palette was missing its art")
    if not isinstance(layers, list) or not isinstance(z_layer, list):
        raise ValueError("Tiles palette was missing its layer structure")

    icon_svg = ""
    icons = game_data.get("iconsSVG")
    if isinstance(icons, str):
        match = re.search(
            r'(<symbol[^>]*id="' + re.escape(filename) + r'".*?</symbol>)', icons, re.DOTALL
        )
        if match:
            icon_svg = match.group(1)

    # Keys match save_palette's parameters so callers can splat this directly.
    return {
        "filename": filename,
        "display_name": normalize_text(game_data.get("displayName"), max_length=80) or filename.title(),
        "created_by": normalize_text(game_data.get("createdBy"), max_length=120),
        "bg_color": normalize_text(game_data.get("bgColor"), max_length=32) or "#f5f5f5",
        "font_color": normalize_text(game_data.get("fontColor"), max_length=32) or "#121212",
        "selection_color": normalize_text(game_data.get("selectionColor"), max_length=32) or "#dcdcdc",
        "z_layer": z_layer,
        "layers": layers,
        "svg": svg.replace("xlink:href=", "href=") if svg else "",
        "icon_svg": icon_svg.replace("xlink:href=", "href=") if icon_svg else "",
    }


def extract_tiles_game_data(raw_html: str) -> dict[str, Any]:
    """Pull the ``window.gameData = {...}`` JSON out of the Tiles page.

    A brace-balanced scan (skipping string contents) handles whatever follows the
    object, matching the extractor used for Spelling Bee and Letter Boxed.
    """
    marker = re.search(r"window\.gameData\s*=\s*", raw_html)
    if marker is None:
        raise ValueError("Tiles game data was missing")

    start = raw_html.find("{", marker.end())
    if start == -1:
        raise ValueError("Tiles game data was malformed")

    depth = 0
    in_string = False
    escaped = False
    end = None
    for index in range(start, len(raw_html)):
        char = raw_html[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                end = index + 1
                break

    if end is None:
        raise ValueError("Tiles game data was unbalanced")

    data = json.loads(unescape(raw_html[start:end]))
    if not isinstance(data, dict) or "svg" not in data:
        raise ValueError("Tiles game data was not in the expected shape")
    return data


# --- Fallback ---------------------------------------------------------------


def load_fallback_palettes() -> list[dict[str, Any]]:
    with _FALLBACK_PATH.open(encoding="utf-8") as handle:
        palettes = json.load(handle)
    if not isinstance(palettes, list) or not palettes:
        raise RuntimeError("Tiles fallback data was empty")
    # Keys match save_palette's parameters so callers can splat this directly.
    return [
        {
            "filename": palette["filename"],
            "display_name": palette["displayName"],
            "created_by": palette.get("createdBy", ""),
            "bg_color": palette["bgColor"],
            "font_color": palette["fontColor"],
            "selection_color": palette["selectionColor"],
            "z_layer": palette["zLayer"],
            "layers": palette["layers"],
            "svg": palette["svg"].replace("xlink:href=", "href=") if palette.get("svg") else "",
            "icon_svg": palette.get("iconSVG", "").replace("xlink:href=", "href=") if palette.get("iconSVG") else "",
        }
        for palette in palettes
    ]


def load_fallback_palette(filename: str) -> dict[str, Any] | None:
    for palette in load_fallback_palettes():
        if palette["filename"] == filename:
            return palette
    return None


# --- Persistence ------------------------------------------------------------


def get_cached_palette(filename: str) -> dict[str, Any] | None:
    with connect_tiles() as connection:
        row = connection.execute(
            """
            SELECT filename, display_name, created_by, bg_color, font_color,
                   selection_color, z_layer_json, layers_json, svg, icon_svg,
                   status, source_json, fetched_at, updated_at
            FROM tiles_palettes
            WHERE filename = ?
            """,
            (filename,),
        ).fetchone()
    return serialize_palette(row) if row else None


def list_cached_palettes() -> list[dict[str, Any]]:
    with connect_tiles() as connection:
        rows = connection.execute(
            "SELECT filename, display_name, created_by, status FROM tiles_palettes"
        ).fetchall()
    return [
        {
            "filename": row["filename"],
            "displayName": row["display_name"],
            "createdBy": row["created_by"] or "",
            "status": row["status"],
        }
        for row in rows
    ]


def save_palette(
    *,
    filename: str,
    display_name: str,
    created_by: str,
    bg_color: str,
    font_color: str,
    selection_color: str,
    z_layer: list[str],
    layers: list[list[str]],
    svg: str,
    icon_svg: str,
    status: str,
    source: dict[str, Any],
) -> dict[str, Any]:
    now = datetime.now().astimezone().isoformat()
    with connect_tiles() as connection:
        connection.execute(
            """
            INSERT INTO tiles_palettes (
              filename, display_name, created_by, bg_color, font_color,
              selection_color, z_layer_json, layers_json, svg, icon_svg,
              status, source_json, fetched_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(filename) DO UPDATE SET
              display_name = excluded.display_name,
              created_by = excluded.created_by,
              bg_color = excluded.bg_color,
              font_color = excluded.font_color,
              selection_color = excluded.selection_color,
              z_layer_json = excluded.z_layer_json,
              layers_json = excluded.layers_json,
              svg = excluded.svg,
              icon_svg = excluded.icon_svg,
              status = excluded.status,
              source_json = excluded.source_json,
              updated_at = excluded.updated_at
            """,
            (
                filename,
                display_name,
                created_by,
                bg_color,
                font_color,
                selection_color,
                json.dumps(z_layer, separators=(",", ":")),
                json.dumps(layers, separators=(",", ":")),
                svg,
                icon_svg,
                status,
                json.dumps(source, separators=(",", ":")),
                now,
                now,
            ),
        )

    cached = get_cached_palette(filename)
    if cached is None:
        raise RuntimeError("Unable to cache Tiles palette")
    return cached


def serialize_palette(row) -> dict[str, Any]:
    svg = row["svg"].replace("xlink:href=", "href=") if row["svg"] else ""
    icon_svg = row["icon_svg"].replace("xlink:href=", "href=") if row["icon_svg"] else ""
    return {
        "filename": row["filename"],
        "displayName": row["display_name"],
        "createdBy": row["created_by"] or "",
        "bgColor": row["bg_color"],
        "fontColor": row["font_color"],
        "selectionColor": row["selection_color"],
        "zLayer": json.loads(row["z_layer_json"]),
        "layers": json.loads(row["layers_json"]),
        "svg": svg,
        "iconSVG": icon_svg,
        "status": row["status"],
        "source": json.loads(row["source_json"]),
        "fetched_at": row["fetched_at"],
    }
