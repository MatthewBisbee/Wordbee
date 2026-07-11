# Algorithm Notes

This file records the non-obvious project logic that a future maintainer or AI
agent should understand before changing puzzle sourcing, stats, or production
data handling.

## Midi Grid Reconstruction

The Midi is subscriber-only at NYT, but the daily production refresh can usually
run without an NYT cookie. The implementation lives in
`backend/app/games/midi.py` and `backend/app/games/midi_reconstruct.py`.

The inputs are:

- NYT's free `v2/puzzle/midi.json` metadata for today's width, height, author,
  editor, title, and publication date.
- A third-party daily clue list with each clue number, direction, clue text, and
  answer.

The missing piece is the grid geometry: which cells are blocks and where every
answer starts. `midi_reconstruct.solve_grid()` rebuilds that geometry using NYT
Mini/Midi numbering rules:

- Numbering scans left-to-right and top-to-bottom.
- An open cell receives a clue number if it starts Across, Down, or both.
- Across starts when the left side is a block/edge and the right side is open.
- Down starts when the top side is a block/edge and the bottom side is open.

The solver is a complete reading-order backtracker. At each cell it branches
only where the grid is genuinely undecided:

- an unknown cell can be a block or an open numbered start;
- a prefilled crossing letter may or may not begin a perpendicular word;
- Across and Down placements propagate letters through intersections;
- closed Down runs must match known Down answers;
- open Down prefixes must be prefixes of known Down answers;
- the total block count is capped from the Across/Down answer lengths.

`solve_grid()` returns one of four statuses:

- `unique`: exactly one grid satisfies the clue numbering, answers, dimensions,
  and intersections.
- `ambiguous`: more than one grid satisfies the data.
- `none`: no grid satisfies the data.
- `budget`: the search hit its node budget before proving a result.

Production only stores a reconstructed Midi when the status is `unique`. Any
other result is treated as unconfirmed and falls back to the cookie-backed
historical fetch path. That rule is intentional: the app may fail to confirm a
day, but it should never store a wrong-but-consistent Midi grid. The solver was
validated against the full NYT Midi history by comparing reconstructed grids to
cookie-fetched historical grids, with unique and correct results across that
validation set.

`build_normalized_from_grid()` then converts the solved grid into the same durable
shape used by The Crossword and The Mini, so the frontend, validation, reveal,
calendar, and stats code do not need a Midi-specific grid format.

## Wordle Skill And Luck

Wordle analysis is derived at solve time and cached in
`friends_family_daily_analysis`, but the raw game result remains the source of
truth. The core implementation is in `backend/app/stats.py`.

For each result, `analyze_solve_path()` starts with the full valid Wordle guess
set plus the actual answer. It then replays the user's guesses in order. Each
guess creates a color pattern using `score_guess(answer, guess)`, then filters
the candidate set to only words that would have produced that same pattern.

For each turn:

- `before` is the number of possible answers before the guess.
- `after` is the number of possible answers left after the actual clue.
- `partition` groups every candidate by the clue pattern that the guess would
  produce against it.
- `expected_after = sum(bucket_size * bucket_size) / before`.

That `expected_after` is the expected remaining candidate count for the guess. It
weights each possible clue pattern by how many answers would produce it, so large
buckets correctly count as more likely.

### Skill

Skill measures how efficiently the chosen guess split the remaining possibilities
compared with the best available guess the analyzer considered for that turn.

The formula is:

```text
possible_gain = max(1, before - best_after)
actual_gain = max(0, before - expected_after)
skill = clamp(round((actual_gain / possible_gain) * 100), 0, 100)
```

Where:

- `best_after` is the lowest expected remaining count found by
  `find_best_available_guess()`.
- On turn 1, the comparison pool includes the actual opener, recommended
  starters, and the top ranked openers from `score_opener()`.
- In the midgame, the comparison pool prefers current candidates, capped for
  performance on large sets.
- If only one candidate remains, playing that candidate scores 100; playing
  something else scores 0.

Skill does not reward getting a lucky color pattern. It grades the guess by its
average information value before the answer-specific clue is known.

### Luck

Luck measures whether the actual clue pattern was better or worse than the guess
usually produces.

Inputs:

- `after`: candidates left by the actual clue.
- `expected_after`: average candidates left by this guess.
- `smallest_after`: smallest bucket in the guess's clue partition.
- `largest_after`: largest bucket in the guess's clue partition.

If every possible clue leaves the same bucket size, luck is neutral:

```text
luck = 50
```

If the actual clue was better than expected:

```text
luck = clamp(round(50 + 50 * ((expected_after - after) /
                             max(1, expected_after - smallest_after))), 50, 100)
```

If the actual clue was worse than expected:

```text
luck = clamp(round(50 - 50 * ((after - expected_after) /
                             max(1, largest_after - expected_after))), 0, 50)
```

So 50 is neutral, values above 50 mean the answer gave a more helpful clue than
the guess usually gets, and values below 50 mean it gave a less helpful clue.

The result-level Wordle `skill` and `luck` are rounded averages of the per-turn
scores. `openerScore` is the first turn's skill score.

### Path Labels

`create_path_label()` is intentionally simple and stable:

- lost results: `Stumped`
- wins in one or two guesses: `Fast solve`
- wins with skill at least 85: `Efficient path`
- wins in three or four guesses: `Solid solve`
- all other wins: `Close finish`

## Pips Validation

Pips puzzle data is stored in `pips.sqlite` by date and difficulty. The public
frontend payload includes the board, region constraints, and domino bag, but not
the constructor solution. Submitted boards are validated server-side in
`backend/app/games/pips.py`.

A completed Pips board only passes if:

- every board cell is covered exactly once;
- every placed domino exists in the puzzle's bag, respecting duplicates;
- every domino placement is orthogonally adjacent and in bounds;
- every region satisfies its rule: sum, less-than, greater-than, equal, or
  unequal.

The UI can show live constraint feedback because the constraints are public, but
the backend remains authoritative for final completion.

## Production Data Rule

Never replace the live Pi `data/` directory during a deploy. Production user
profiles, active sessions, completed game rows, attempts, and analysis rows live
there. App code, frontend builds, scripts, and infrastructure templates can be
replaced from a new package; schema changes should be shipped as idempotent
migrations through `backend/schema.sql` and `backend/app/db.py:migrate_db()`.

See `docs/pi-deployment-workflow.md` for the Pi packaging and deployment process.
