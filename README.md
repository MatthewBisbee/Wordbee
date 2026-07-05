# Wordbee

Wordbee is a self-hosted daily word game for a private friends and family group. The current app includes the React game client, Flask API, SQLite persistence, friends-and-family access, daily stats, and the deployment scaffold for nginx, Cloudflare Tunnel, and a Raspberry Pi host.

## Current Status

- Frontend: playable Vite + React + TypeScript daily word game with mobile-first game, settings, avatar, results, and stats surfaces.
- Gameplay: six guesses, five-letter answer, valid-word checks, daily play, untracked endless random play, untracked past-word play for official dates starting `2021-06-19`, high-contrast mode, theme settings, friends-and-family avatar setup, on-screen keyboard, keyboard state, tile reveal animations, win/loss states, and local settings persistence.
- Backend: Flask + SQLite API fetches, caches, and scores the daily answer while preserving a dated answer archive, validating friends-and-family access codes server-side, creating new family users only after avatar save, reclaiming saved profiles on load, and tracking friends-and-family-only daily stats.
- Stats: friends-and-family stats are a full-page dashboard with overview, player, daily-review, starter-word, trend, leaderboard, skill, luck, and solve-path analysis views. Current-day answers, guesses, boards, and analysis remain locked for a signed-in user until that user solves the current daily puzzle.
- Deployment: nginx, cloudflared, and systemd placeholders are included for the future Raspberry Pi setup.

## Tech Stack

- Frontend: React 19, TypeScript, Vite, Oxlint.
- Backend plan: Flask, SQLite.
- Deployment plan: nginx reverse proxy, Cloudflare Tunnel, and systemd service.

## Project Structure

```text
.
├── backend/        # Planned Flask API and SQLite backend
├── data/           # Local runtime data placeholder
├── docs/           # Architecture, API, auth, and database planning notes
├── frontend/       # Vite + React game client
├── infra/          # Deployment config placeholders
├── tests/          # Future test notes
├── package.json    # Root convenience scripts for the frontend
└── README.md
```

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

Or run each side separately:

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

Friends-and-family access codes and ntfy notification values are configured with server-side environment values only. Add private code groups, topic/title/token values, and a deployment `SECRET_KEY` to `.env`; keep real private values out of Git.

## Backend Status

The backend currently provides daily answer fetching, SQLite caching, guess scoring, signed untracked random and past puzzle tokens, friends-and-family sign-in with pending avatar setup for new names, daily result lockout, ntfy-safe first-save notifications, and friends-and-family-only stats/history.

Answer caching uses one `daily_answers` row per date. Official historical play starts on `2021-06-19`; out-of-range past-word requests open the nearest playable puzzle between the first playable day and yesterday. Development fallback answers are not persisted as historical truth.

Planned additions include:

- Session handling with HttpOnly cookies.
- Broader leaderboard views.
- Production migration helpers for long-lived deployments.

See the planning docs in `docs/` for more detail.

## Data Sources

Word metadata is enriched with the Free Dictionary API and the Datamuse API. Definition usage sentences are intentionally not shown because third-party examples were unreliable for this game.

Friends-and-family profile avatars are synced as server profile metadata and rendered with DiceBear's Notionists SVG HTTP API.

## Deployment Roadmap

The intended production path is:

```text
Browser -> Cloudflare Tunnel -> nginx -> Flask API -> SQLite
```

nginx is expected to serve the built frontend and reverse-proxy `/api` requests to the Flask backend.

## License

Wordbee is released under the MIT License. See `LICENSE`.
