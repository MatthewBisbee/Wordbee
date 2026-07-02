# Wordbee Backend

This directory is reserved for the planned Flask + SQLite backend.

The current backend fetches and caches the daily answer, exposes the game metadata API, scores guesses, and preserves each fetched answer by date in SQLite.

Current responsibilities:

- Serve daily puzzle metadata without exposing the answer up front.
- Score guesses server-side.
- Store fetched daily answers in SQLite for a future archive replayer.

Planned responsibilities:

- Store completed games and guesses in SQLite.
- Support guest play and private Wordbee sessions.
- Expose daily and all-time leaderboard APIs.
