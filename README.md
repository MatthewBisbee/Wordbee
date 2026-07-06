# Wordbee

Wordbee is a self-hosted private games hub for a friends-and-family group. The project ships Wordle, Sudoku, Connections, and Strands with a React game client, Flask API, SQLite persistence, family access, avatar profiles, daily stats/history, and deployment scaffolding for nginx, Cloudflare Tunnel, and a Raspberry Pi host.

## Current Status

- Platform: Wordbee is the site and app shell. The left menu is structured as a game picker, with Wordle, Sudoku, Connections, and Strands as separate playable surfaces.
- Wordle gameplay: daily play, endless random play, and past-date play for official dates starting `2021-06-19`; six guesses; five-letter answer; valid-word checks; tile reveal animations; win/loss states; high-contrast mode; dark theme; mobile and installed iOS web-app layout support.
- Sudoku gameplay: daily Easy/Medium/Hard boards, number-pad entry, keyboard number entry, peer highlighting, mistake highlighting, server-side solution checks, and family result history.
- Connections gameplay: daily sixteen-card board, four-card group submission, one-away feedback, mistake limit, post-loss reveal, server-side group validation, and family result history.
- Strands gameplay: daily letter grid, adjacent-letter path selection, theme-word and spangram validation, bonus-word tracking, reveal, and family result history.
- Daily persistence: signed-in family users resume an unfinished daily Wordle from the server after refresh, and completed daily results are locked to one result per user per puzzle date.
- Daily rollover: the backend resolves the active daily date in `America/Chicago` by default, blocks future daily gameplay before Central midnight, and can cache the next official answer without making it playable early.
- Friends-and-family access: private access codes are validated server-side, family users are created only after avatar save, saved profiles are reclaimed on load, and one active browser session is enforced per user.
- Avatar profiles: avatars are stored as server profile metadata and rendered from DB-backed state on refresh, so browser storage does not become the source of truth for signed-in users.
- Stats: the Wordle family dashboard includes overview accolade cards with avatars, solve distribution, first-word habits, player detail, daily review, starter-word history, trends, leaderboard sorting, skill/luck analysis, and solve-path analysis. Sudoku, Connections, and Strands include simpler family solve-rate and recent-play history.
- Current-day privacy: current-day answers, guesses, boards, and analysis remain locked in stats until the requesting signed-in user solves that day's Wordle.
- Deployment: nginx, cloudflared, and systemd placeholders are included for the Raspberry Pi deployment path.

## Tech Stack

- Frontend: React 19, TypeScript, Vite, Oxlint.
- Backend: Flask, SQLite, Requests.
- Deployment: nginx reverse proxy, Cloudflare Tunnel, and systemd.

## Project Structure

```text
.
├── backend/        # Flask API, SQLite access, auth, stats, notifications, game modules
├── data/           # Local SQLite runtime data, ignored by Git
├── docs/           # Architecture, API, auth, and database planning notes
├── frontend/       # Vite + React Wordbee client, feature modules, and Wordle UI
├── infra/          # Deployment config placeholders
├── tests/          # Test notes and smoke-test context
├── package.json    # Root convenience scripts
└── README.md
```

Frontend source is organized around the Wordbee platform shell and feature folders. `frontend/src/App.tsx` owns top-level state and API flow orchestration, `features/wordle/`, `features/sudoku/`, `features/connections/`, and `features/strands/` contain game implementations, `features/games/` contains shared non-Wordle history/API helpers, and `features/avatar/`, `features/access/`, `features/settings/`, `features/results/`, and `features/stats/` hold reusable product surfaces. Backend game-specific code lives under `backend/app/games/`, with Wordle scoring in `backend/app/games/wordle.py` and the added daily puzzle/result service in `backend/app/games/multigame.py`.

## Getting Started

Install frontend dependencies:

```bash
npm --prefix frontend install
```

Install backend dependencies:

```bash
python3 -m pip install -r backend/requirements.txt
```

Run the full local app:

```bash
npm run dev
```

This starts Flask on `127.0.0.1:5001` and Vite on `0.0.0.0:5173`. Use `http://localhost:5173` on the host machine, or the Network URL Vite prints to test from another device on the same LAN.

Run the same full app on localhost only:

```bash
npm run dev:local
```

This keeps Flask on `127.0.0.1:5001` and starts Vite with `--host 127.0.0.1`, so the frontend does not expose a LAN URL.

Run each side separately:

```bash
npm run api
npm run dev:frontend
```

Build the frontend:

```bash
npm run build
```

Lint the frontend:

```bash
npm run lint
```

## Environment

Copy the example environment file before adding local secrets or deployment-specific values:

```bash
cp .env.example .env
```

Do not commit `.env` or local SQLite database files.

Important environment values include:

- `SECRET_KEY`: signs family sessions and untracked puzzle tokens.
- `DATABASE_PATH`: optional override for the SQLite database location.
- `WORDBEE_FRIENDS_FAMILY_CODES`: server-only family access code groups.
- `WORDBEE_PUZZLE_TIMEZONE`: active daily rollover timezone; defaults to `America/Chicago`.
- `WORDBEE_NTFY_*`: optional ntfy completion and suggestion notifications.
- `WORDBEE_ENABLE_DEV_FALLBACK`: local-only daily Wordle answer fallback for development.

## Backend Behavior

The backend provides daily Wordle answer fetching, SQLite answer caching, server-side Wordle scoring, signed random and past-date Wordle tokens, family sign-in, avatar persistence, daily result lockout, in-progress daily attempt persistence, first-save notifications, and family-only Wordle stats/history. It also provides separate daily cache tables and result history for Sudoku, Connections, and Strands.

Answer caching uses one `daily_answers` row per date. Future official answers may be fetched and cached early, but daily gameplay/status endpoints reject future dates until Central midnight. Historical play starts on `2021-06-19`; out-of-range past-date requests open the nearest playable puzzle between the first playable day and yesterday. Development fallback answers are not persisted as historical truth.

Random and past-date Wordle results are intentionally untracked in family stats. They can show session solve analysis, but only daily Wordle completions write to the family results tables.

Sudoku, Connections, and Strands use separate `daily_*` cache tables plus `friends_family_game_results`, keyed by game and date. They do not write to Wordle's daily result, attempt, or stats tables.

## Data Sources

Daily Wordle answers, Connections boards, and Strands boards are fetched from public dated game endpoints and cached by date. Sudoku is fetched from the current daily page payload when available. The added games include deterministic generated fallbacks so local development still has playable puzzles if an upstream request fails. Word metadata is enriched with the Free Dictionary API and the Datamuse API. Definition usage sentences are intentionally not shown because third-party examples were unreliable for this game.

Friends-and-family profile avatars are stored in SQLite and rendered with DiceBear's Notionists SVG HTTP API.

## Deployment Roadmap

The intended production path is:

```text
Browser -> Cloudflare Tunnel -> nginx -> Flask API -> SQLite
```

nginx is expected to serve the built frontend and reverse-proxy `/api` requests to the Flask backend. The Flask process must be restarted after backend deploys so timezone, cache, and gameplay guard changes are active.

## License

Wordbee is released under the MIT License. See `LICENSE`.
