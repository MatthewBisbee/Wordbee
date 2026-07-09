"""Reconstruct a Midi grid from a numbered clue list (no NYT auth needed).

The Midi is subscriber-only, so its daily refresh can't use NYT's answer feed.
Third-party answer sites publish a *credible, consistent* daily clue list — clue
number, direction and answer for every Across/Down entry — but never the grid
geometry (which squares are blocks). This module recovers that geometry.

NYT Mini/Midi grids are standard: numbering runs left-to-right, top-to-bottom; a
cell is numbered iff it starts an Across (block/edge to its left, open to its
right) and/or a Down (block/edge above, open below). Given the answers keyed by
number, the block layout is recovered by a reading-order backtracking search:
each numbered cell forces its Across word (``num`` in the Across set) and/or Down
word (``num`` in the Down set), letters propagate through intersections, and the
only branch points are undecided cells (block vs open) and crossing cells that
may or may not begin a perpendicular word. It is *complete* — it represents
unchecked cells in either direction, so it never fabricates a wrong-but-consistent
grid — and reports whether the solution is unique.

Correctness is the priority: the caller only trusts a ``unique`` result. An
``ambiguous`` / ``none`` / ``budget`` outcome means "don't confirm today" (fall
back to the cookie backfill), so a wrong grid is never stored. Validated against
the full NYT Midi history (via the operator's cookie) as 100% unique + correct.
"""
from __future__ import annotations

from collections import Counter
from typing import Any


class _Budget(Exception):
    pass


def solve_grid(
    across: dict[int, str],
    down: dict[int, str],
    width: int,
    height: int,
    *,
    node_budget: int = 250_000_000,
    cap: int = 2,
) -> tuple[str, list[str] | None]:
    """Recover the block/letter grid from numbered Across/Down answers.

    Returns ``(status, grid)`` where ``status`` is ``"unique"`` (grid = list of
    ``height`` strings of letters and ``'#'``), ``"ambiguous"`` (>1 solution),
    ``"none"`` (no consistent grid) or ``"budget"`` (search cut off).
    """
    A = {int(k): str(v).upper() for k, v in across.items()}
    D = {int(k): str(v).upper() for k, v in down.items()}
    a_set, d_set = set(A), set(D)
    if not (a_set | d_set):
        return ("none", None)
    max_num = max(a_set | d_set)

    down_multi = Counter(D.values())
    down_prefix: set[str] = set()
    for word in D.values():
        for k in range(1, len(word) + 1):
            down_prefix.add(word[:k])

    # Every Across-checked open cell is counted by the Across lengths (likewise
    # Down), so the grid has at least this many open cells — a hard cap on blocks.
    min_open = max(sum(len(w) for w in A.values()), sum(len(w) for w in D.values()))
    max_blocks = width * height - min_open

    grid: list[list[str | None]] = [[None] * width for _ in range(height)]
    solutions: list[list[str]] = []
    nodes = [0]
    blocks = [0]

    def is_letter(value: str | None) -> bool:
        return value is not None and value != "#"

    def undo_all(undo: list[tuple[int, int]]) -> None:
        for rr, cc in undo:
            if grid[rr][cc] == "#":
                blocks[0] -= 1
            grid[rr][cc] = None

    def set_cell(r: int, c: int, value: str, undo: list[tuple[int, int]]) -> bool:
        if 0 <= r < height and 0 <= c < width:
            current = grid[r][c]
            if current is None:
                grid[r][c] = value
                undo.append((r, c))
                if value == "#":
                    blocks[0] += 1
                    if blocks[0] > max_blocks:
                        return False
                    if not close_ok_above(r, c):
                        return False
                return True
            return current == value
        return value == "#"  # out of range = an implied block/edge

    def prefix_ok(r: int, c: int) -> bool:
        s = r
        while s >= 0 and is_letter(grid[s][c]):
            s -= 1
        if r - s >= 2:
            run = "".join(grid[i][c] for i in range(s + 1, r + 1))
            if run not in down_prefix:
                return False
        return True

    def close_ok_above(r: int, c: int) -> bool:
        s = r - 1
        while s >= 0 and is_letter(grid[s][c]):
            s -= 1
        if (r - 1) - s >= 2:
            run = "".join(grid[i][c] for i in range(s + 1, r))
            if down_multi.get(run, 0) == 0:
                return False
        return True

    def place_across(r: int, c: int, num: int, undo: list[tuple[int, int]]) -> bool:
        word = A[num]
        length = len(word)
        if c + length > width:
            return False
        for k in range(length):
            if not set_cell(r, c + k, word[k], undo):
                return False
        if c + length < width and not set_cell(r, c + length, "#", undo):
            return False
        return all(prefix_ok(r, c + k) for k in range(length))

    def place_down(r: int, c: int, num: int, undo: list[tuple[int, int]]) -> bool:
        word = D[num]
        length = len(word)
        if r + length > height:
            return False
        for k in range(length):
            if not set_cell(r + k, c, word[k], undo):
                return False
        if r + length < height and not set_cell(r + length, c, "#", undo):
            return False
        return True

    def rec(pos: int, num: int) -> None:
        nodes[0] += 1
        if nodes[0] > node_budget:
            raise _Budget()
        if len(solutions) >= cap:
            return
        if pos == width * height:
            if num == max_num + 1:
                verify()
            return
        r, c = divmod(pos, width)
        current = grid[r][c]
        if current == "#":
            rec(pos + 1, num)
            return
        left_block = c == 0 or grid[r][c - 1] == "#"
        above_block = r == 0 or grid[r - 1][c] == "#"

        if current is None:
            # Undecided both-block cell: branch block vs open.
            undo: list[tuple[int, int]] = []
            if set_cell(r, c, "#", undo):
                rec(pos + 1, num)
            undo_all(undo)
            if len(solutions) >= cap or num > max_num:
                return
            across_start = num in a_set
            down_start = num in d_set
            if not (across_start or down_start):
                return
            undo = []
            ok = True
            if across_start:
                ok = place_across(r, c, num, undo)
            elif c + 1 < width and not set_cell(r, c + 1, "#", undo):
                ok = False
            if ok and down_start:
                ok = place_down(r, c, num, undo)
            elif ok and r + 1 < height and not set_cell(r + 1, c, "#", undo):
                ok = False
            if ok and grid[r][c] in (None, "#"):
                ok = False
            if ok:
                rec(pos + 1, num + 1)
            undo_all(undo)
            return

        # A pre-filled letter (from a perpendicular word).
        if not left_block and not above_block:
            rec(pos + 1, num)
            return
        if left_block and not above_block:
            # Candidate Across-start sitting mid Down-word.
            if num <= max_num and num in a_set and A[num][0] == current:
                undo = []
                if place_across(r, c, num, undo):
                    rec(pos + 1, num + 1)
                undo_all(undo)
                if len(solutions) >= cap:
                    return
            undo = []
            if not (c + 1 < width and not set_cell(r, c + 1, "#", undo)):
                rec(pos + 1, num)
            undo_all(undo)
            return
        if above_block and not left_block:
            if num <= max_num and num in d_set and D[num][0] == current:
                undo = []
                if place_down(r, c, num, undo):
                    rec(pos + 1, num + 1)
                undo_all(undo)
                if len(solutions) >= cap:
                    return
            undo = []
            if not (r + 1 < height and not set_cell(r + 1, c, "#", undo)):
                rec(pos + 1, num)
            undo_all(undo)
            return
        rec(pos + 1, num)

    def verify() -> None:
        block = [[grid[r][c] == "#" for c in range(width)] for r in range(height)]
        sa: dict[int, tuple[int, int]] = {}
        sd: dict[int, tuple[int, int]] = {}
        cur = 1
        for r in range(height):
            for c in range(width):
                if block[r][c]:
                    continue
                start_a = (c == 0 or block[r][c - 1]) and (c + 1 < width and not block[r][c + 1])
                start_d = (r == 0 or block[r - 1][c]) and (r + 1 < height and not block[r + 1][c])
                if start_a or start_d:
                    if start_a:
                        sa[cur] = (r, c)
                    if start_d:
                        sd[cur] = (r, c)
                    cur += 1
        if set(sa) != a_set or set(sd) != d_set:
            return
        for num, (r, c) in sa.items():
            word = A[num]
            if c + len(word) > width:
                return
            for k, ch in enumerate(word):
                if block[r][c + k] or grid[r][c + k] != ch:
                    return
        for num, (r, c) in sd.items():
            word = D[num]
            if r + len(word) > height:
                return
            for k, ch in enumerate(word):
                if block[r + k][c] or grid[r + k][c] != ch:
                    return
        solutions.append(
            ["".join("#" if block[r][c] else (grid[r][c] or "?") for c in range(width)) for r in range(height)]
        )

    try:
        rec(0, 1)
    except _Budget:
        return ("budget", None)
    if len(solutions) >= 2:
        return ("ambiguous", None)
    if len(solutions) == 1:
        return ("unique", solutions[0])
    return ("none", None)


def build_normalized_from_grid(
    grid: list[str],
    width: int,
    height: int,
    across: dict[int, str],
    down: dict[int, str],
    across_text: dict[int, str],
    down_text: dict[int, str],
) -> dict[str, Any]:
    """Assemble the durable ``{cells, clues}`` puzzle from a solved grid.

    Mirrors the shape ``grid_common.normalize_v6_grid_payload`` produces so the
    reconstructed Midi is indistinguishable from a cookie-fetched one downstream.
    """
    block = [[grid[r][c] == "#" for c in range(width)] for r in range(height)]
    labels: dict[int, str] = {}
    across_start: dict[int, tuple[int, int]] = {}
    down_start: dict[int, tuple[int, int]] = {}
    cur = 1
    for r in range(height):
        for c in range(width):
            if block[r][c]:
                continue
            start_a = (c == 0 or block[r][c - 1]) and (c + 1 < width and not block[r][c + 1])
            start_d = (r == 0 or block[r - 1][c]) and (r + 1 < height and not block[r + 1][c])
            if start_a or start_d:
                labels[r * width + c] = str(cur)
                if start_a:
                    across_start[cur] = (r, c)
                if start_d:
                    down_start[cur] = (r, c)
                cur += 1

    cells: list[dict[str, Any] | None] = []
    for index in range(width * height):
        r, c = divmod(index, width)
        if block[r][c]:
            cells.append(None)
        else:
            cells.append({"answer": grid[r][c], "label": labels.get(index)})

    clues: list[dict[str, Any]] = []
    for num, (r, c) in sorted(across_start.items()):
        length = len(across[num])
        clues.append(
            {
                "label": str(num),
                "direction": "across",
                "cells": [r * width + (c + k) for k in range(length)],
                "text": across_text.get(num, ""),
            }
        )
    for num, (r, c) in sorted(down_start.items()):
        length = len(down[num])
        clues.append(
            {
                "label": str(num),
                "direction": "down",
                "cells": [(r + k) * width + c for k in range(length)],
                "text": down_text.get(num, ""),
            }
        )
    return {"cells": cells, "clues": clues}
