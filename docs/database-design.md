# Database Design

The backend uses SQLite.

Current tables:

- `daily_answers`: one row per fetched puzzle date, including answer, answer length, confidence, source status, source metadata JSON, and fetch/update timestamps.
- `completed_games`: one row per completed daily game, including outcome, guess count, hard mode, board states JSON, and completion timestamp.
- `word_definitions`: one row per fetched definition, including pronunciation text, part of speech, definition, example, synonyms JSON, source URL, and timestamps.

Planned tables may include `users`, `sessions`, `games`, and `guesses`, or stored guess JSON.
