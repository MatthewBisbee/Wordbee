# Database Design

The backend uses SQLite.

Current tables:

- `daily_answers`: one row per fetched puzzle date, including answer, answer length, confidence, source status, source metadata JSON, and fetch/update timestamps.
- `completed_games`: legacy aggregate result table for earlier daily result summaries.
- `friends_family_users`: one row per unique friends-and-family code group plus first name, last initial, and synced avatar config JSON.
- `friends_family_sessions`: server-issued login sessions. Newer sessions replace older active sessions for the same user.
- `friends_family_daily_results`: one row per friends-and-family user per puzzle date, including answer, outcome, guess count, starter word, guesses JSON, board states JSON, and completion timestamp.
- `word_definitions`: one row per fetched definition, including pronunciation text, part of speech, definition, an intentionally blank example field, synonyms JSON, source URL, and timestamps.

Random and past-word play are intentionally excluded from friends-and-family stats tables.

Stats derivation notes:

- Daily result rows are the raw recording layer for future stats work: date, answer, outcome, guesses, board states, and completion time are stored.
- Skill, luck, solve-path labels, starter aggregates, trends, and leaderboard values are derived from raw rows at response time rather than persisted as source-of-truth fields.
- Dashboard responses cap display history, recent results, and daily timeline windows so the browser does not receive every historical board as the dataset grows.

Daily answer archive notes:

- Official historical play starts on `2021-06-19`.
- The `daily_answers` primary key keeps the archive to one row per puzzle date.
- Development fallback answers are ignored by cache reads and are not written as historical records.

Stats privacy notes:

- Current-day stats are visible only after the requesting friends-and-family user has solved that day's puzzle.
- Before that, current-day result rows are returned as locked placeholders without answer, guesses, board states, or solve analysis.
