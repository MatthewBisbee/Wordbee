# API

Current endpoints:

- `GET /api/health`
- `GET /api/today`
- `POST /api/guess`

`GET /api/today` returns the active puzzle date, answer length, confidence score, source status, sanitized source metadata, and fetch timestamp. It does not return the answer.

`POST /api/guess` accepts a date, guess, and optional final-reveal flag. It validates the guess, returns tile scores, and returns the answer only when the final-reveal flag is set.

Planned endpoints:

- `POST /api/fnf/login`
- `POST /api/fnf/logout`
- `GET /api/me`
- `GET /api/leaderboard/today`
- `GET /api/leaderboard/all-time`
