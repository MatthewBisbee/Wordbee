# Wordbee Frontend

This is the Vite + React + TypeScript client for Wordbee.

The client includes the game board, keyboard, settings, friends-and-family access, avatar editor, results view, and full-page stats dashboard. Avatar and stats surfaces should be designed mobile-first because they are routinely used from iOS Safari and other small screens.

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
