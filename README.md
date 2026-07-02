# Wordbee

Wordbee is a self-hosted daily word game for a private friends and family group. The current app includes a playable React prototype and the project scaffold for the planned Flask, SQLite, nginx, Cloudflare Tunnel, and Raspberry Pi deployment path.

## Current Status

- Frontend: playable Vite + React + TypeScript daily word game.
- Gameplay: six guesses, five-letter answer, valid-word checks, high-contrast mode, theme settings, friends-and-family avatar setup, on-screen keyboard, keyboard state, tile reveal animations, win/loss states, and local settings persistence.
- Backend: Flask + SQLite API fetches, caches, and scores the daily answer while preserving a dated answer archive, validating friends-and-family access codes server-side, enforcing active sessions, and tracking family-only daily stats.
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

## Backend Roadmap

The backend currently provides daily answer fetching, SQLite caching, guess scoring, friends-and-family sign-in, daily result lockout, ntfy-safe first-save notifications, and family-only stats/history. Planned additions include:

- Session handling with HttpOnly cookies.
- Broader leaderboard views.
- Production migration helpers for long-lived deployments.

See the planning docs in `docs/` for more detail.

## Data Sources

Word metadata is enriched with the Free Dictionary API and the Datamuse API.

Friends-and-family profile avatars are generated with DiceBear's Notionists SVG HTTP API.

## Deployment Roadmap

The intended production path is:

```text
Browser -> Cloudflare Tunnel -> nginx -> Flask API -> SQLite
```

nginx is expected to serve the built frontend and reverse-proxy `/api` requests to the Flask backend.

## License

Wordbee is released under the MIT License. See `LICENSE`.
