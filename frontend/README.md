# Wordbee Frontend

This is the Vite + React + TypeScript client for Wordbee. Wordbee is the site shell; Wordle is the currently implemented game.

The client includes the Wordle board, keyboard, game picker menu, settings, friends-and-family access, avatar editor, results view, and full-page stats dashboard. Avatar and stats surfaces should be designed mobile-first because they are routinely used from iOS Safari and other small screens.

## Source Layout

- `App.tsx`: top-level Wordbee state, API flow orchestration, and page composition.
- `features/wordle/`: the current Wordle game UI and board helpers.
- `features/access/`, `features/avatar/`, `features/navigation/`, `features/results/`, `features/settings/`, `features/stats/`: focused product surfaces shared by the Wordbee shell and current game.
- `components/`: small shared view primitives.
- `config/`, `lib/`, `types.ts`: constants, browser/API helpers, and shared TypeScript contracts.
- `styles/`: CSS split by UI area, imported in stable order through `styles/index.css`.

## Scripts

```bash
npm install
npm run dev
npm run build
npm run lint
npm run preview
```

The root `package.json` also exposes convenience scripts that run these from the repository root.

`npm run dev` through the root script serves Vite on `0.0.0.0:5173`, so the app is available from `localhost` and from other devices on the same LAN through the Network URL Vite prints.

Use `npm run dev:local` for the same full-stack dev runner with Vite bound only to `127.0.0.1`.
