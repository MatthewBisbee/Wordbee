# Database Design

The backend uses SQLite.

Current tables:

- `daily_answers`: one row per fetched puzzle date, including answer, answer length, confidence, source status, source metadata JSON, and fetch/update timestamps.
- `completed_games`: legacy aggregate result table for earlier daily result summaries.
- `friends_family_users`: one row per unique friends-and-family code group plus first name and last initial.
- `friends_family_sessions`: server-issued login sessions. Newer sessions replace older active sessions for the same user.
- `friends_family_daily_results`: one row per friends-and-family user per puzzle date, including answer, outcome, guess count, starter word, guesses JSON, board states JSON, and completion timestamp.
- `word_definitions`: one row per fetched definition, including pronunciation text, part of speech, definition, example, synonyms JSON, source URL, and timestamps.

Random and past-word play are intentionally excluded from friends-and-family stats tables.
