# API

Current endpoints:

- `GET /api/health`
- `GET /api/today`
- `POST /api/puzzle/random`
- `POST /api/puzzle/past`
- `POST /api/friends-family/validate-code`
- `POST /api/friends-family/login`
- `POST /api/friends-family/avatar`
- `POST /api/friends-family/verify`
- `POST /api/friends-family/sign-out`
- `POST /api/friends-family/today-status`
- `POST /api/friends-family/stats`
- `POST /api/guess`
- `POST /api/results`
- `GET /api/stats`

`GET /api/today` returns the active puzzle date, answer length, confidence score, source status, sanitized source metadata, and fetch timestamp. It does not return the answer.

`POST /api/puzzle/random` returns a signed, untracked puzzle token for endless random play.

`POST /api/puzzle/past` returns a signed, untracked puzzle token for a previous official daily puzzle. Submitted dates before `2021-06-19` are clamped to the first playable puzzle, and submitted dates for today or later are clamped to yesterday.

`POST /api/friends-family/validate-code` checks a submitted access code against server-side environment configuration and returns only success or failure.

`POST /api/friends-family/login` checks the access code plus first name and last initial. Existing users receive a signed identity token immediately. New names receive a pending identity with `requiresAvatar: true`; clients send the same request with `createUser: true` only after the avatar is saved, which creates the family user, makes the new session active, and returns a signed identity token. The token contains identity metadata but no access code.

`POST /api/friends-family/avatar` updates the signed-in user's synced avatar profile metadata.

`POST /api/friends-family/verify` checks a stored signed identity token and returns the friends-and-family identity when still valid. It rejects older sessions once a newer session or tab is active.

`POST /api/friends-family/sign-out` clears the active session for the signed-in user when possible.

`POST /api/friends-family/today-status` returns whether the signed-in family user has already completed the requested daily puzzle, plus their stored result when complete or their active in-progress attempt when not complete.

`POST /api/friends-family/stats` returns full-page stats dashboard data: family overview, per-user summaries, starter-word counts, capped daily history, capped timeline data, leaderboard data, and derived solve analysis. If the requesting user has not solved the current daily puzzle, other players' current-day answer, guesses, board, and analysis are replaced with locked placeholders.

`POST /api/guess` accepts a date or signed untracked puzzle token, guess, optional daily attempt index, and optional final-reveal flag. It validates the guess, records signed-in daily in-progress attempts, returns tile scores, and returns the answer only when the final-reveal flag is set.

`POST /api/results` stores a completed daily result for verified friends-and-family users and returns updated stats.
It also returns the completed answer and definition summary for the completion popup.
Random and past-word results return session-only solve analysis but are not inserted into stats tables.
When ntfy is enabled, this endpoint may publish a completion message only for a verified friends-and-family identity token and only on the first save for that user and puzzle date.

`GET /api/stats` returns played count, win percentage, streaks, and guess distribution for tracked daily games.

Planned endpoints:

- `GET /api/me`
- `GET /api/leaderboard/today`
- `GET /api/leaderboard/all-time`
