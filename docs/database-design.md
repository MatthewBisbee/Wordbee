# Database Design

The backend uses SQLite.

Current tables:

- `daily_answers`: one row per fetched puzzle date, including answer, answer length, confidence, source status, source metadata JSON, and fetch/update timestamps.

Planned tables may include `users`, `sessions`, `games`, and `guesses`, or stored guess JSON.
