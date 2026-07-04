# Architecture

Intended production request path:

Browser -> Cloudflare Tunnel -> nginx -> Flask backend -> SQLite

nginx will eventually serve the frontend and reverse-proxy `/api` requests to Flask.

During local development, `npm run dev` starts Flask on `127.0.0.1:5001` and Vite on `0.0.0.0:5173`. Vite proxies `/api` requests to Flask, so the app works from `localhost` and from another device on the same LAN using Vite's Network URL.

Daily answer flow:

- `GET /api/today` resolves the current puzzle date in the configured puzzle timezone.
- The backend fetches the official answer, stores one `daily_answers` row per date, and reuses cached rows unless stale and unconfirmed.
- Direct daily-answer dates before `2021-06-19` are rejected because that is the first official playable date; past-word play clamps earlier dates to `2021-06-19`.
- Development fallback answers are returned only for the current local development day and are not persisted to the historical archive.

Friends-and-family stats flow:

- Completed daily results are stored once per user and puzzle date.
- Stats are derived from `friends_family_daily_results`.
- Current-day result details for other players are replaced with locked placeholders until the requesting user has completed that day's puzzle.
