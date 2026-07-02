# Wordbee Backend

This directory is reserved for the planned Flask + SQLite backend.

The current backend fetches and caches the daily answer, exposes the game metadata API, scores guesses, validates friends-and-family access, and preserves each fetched answer by date in SQLite.

Current responsibilities:

- Serve daily puzzle metadata without exposing the answer up front.
- Score guesses server-side.
- Validate friends-and-family access codes without exposing private codes to the client.
- Store fetched daily answers in SQLite for a future archive replayer.

Planned responsibilities:

- Store completed games and guesses in SQLite.
- Support richer guest and friends-and-family sessions.
- Expose daily and all-time leaderboard APIs.
