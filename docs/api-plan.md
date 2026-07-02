# API

Current endpoints:

- `GET /api/health`
- `GET /api/today`
- `POST /api/friends-family/validate-code`
- `POST /api/friends-family/login`
- `POST /api/friends-family/verify`
- `POST /api/guess`
- `POST /api/results`
- `GET /api/stats`

`GET /api/today` returns the active puzzle date, answer length, confidence score, source status, sanitized source metadata, and fetch timestamp. It does not return the answer.

`POST /api/friends-family/validate-code` checks a submitted access code against server-side environment configuration and returns only success or failure.

`POST /api/friends-family/login` checks the access code plus first name and last initial, then returns a signed identity token. The token contains identity metadata but no access code.

`POST /api/friends-family/verify` checks a stored signed identity token and returns the friends-and-family identity when still valid.

`POST /api/guess` accepts a date, guess, and optional final-reveal flag. It validates the guess, returns tile scores, and returns the answer only when the final-reveal flag is set.

`POST /api/results` stores a completed daily result and returns updated stats.
It also returns the completed answer and definition summary for the completion popup.
When ntfy is enabled, this endpoint may publish a completion message only for a verified friends-and-family identity token and only on first save for that game id.

`GET /api/stats` returns played count, win percentage, streaks, and guess distribution for tracked daily games.

Planned endpoints:

- `GET /api/me`
- `GET /api/leaderboard/today`
- `GET /api/leaderboard/all-time`
