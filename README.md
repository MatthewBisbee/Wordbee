# Wordbee

Wordbee is a self-hosted daily word game for a private family and friends group. The current app includes a playable React prototype and the project scaffold for the planned Flask, SQLite, nginx, Cloudflare Tunnel, and Raspberry Pi deployment path.

## Current Status

- Frontend: playable Vite + React + TypeScript daily word game.
- Gameplay: six guesses, five-letter answer, valid-word checks, hard mode, high-contrast mode, theme settings, on-screen keyboard, keyboard state, tile reveal animations, win/loss states, and local settings persistence.
- Backend: Flask + SQLite API fetches, caches, and scores the daily answer while preserving a dated answer archive.
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

## Backend Roadmap

The backend currently provides daily answer fetching, SQLite caching, and guess scoring. Planned additions include:

- Guest and private Wordbee modes.
- Session handling with HttpOnly cookies.
- Daily and all-time leaderboards.
- SQLite persistence for completed games, guesses, users, and sessions.

See the planning docs in `docs/` for more detail.

## Deployment Roadmap

The intended production path is:

```text
Browser -> Cloudflare Tunnel -> nginx -> Flask API -> SQLite
```

nginx is expected to serve the built frontend and reverse-proxy `/api` requests to the Flask backend.

## License

Wordbee is released under the MIT License. See `LICENSE`.
