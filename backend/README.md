# Wordbee Backend

This directory contains the Flask + SQLite backend.

The current backend fetches and caches the daily answer, exposes the game metadata API, scores guesses, validates friends-and-family access, preserves each fetched answer by date in SQLite, and tracks friends-and-family-only daily stats.

Current responsibilities:

- Serve daily puzzle metadata without exposing the answer up front.
- Score guesses server-side.
- Validate friends-and-family access codes without exposing private codes to the client.
- Keep one active friends-and-family session per user.
- Store one completed daily result per friends-and-family user per puzzle date.
- Expose family comparison, profile, starter-word, and daily-history stats.
- Store fetched daily answers in SQLite for a future archive replayer.

Planned responsibilities:

- Expose daily and all-time leaderboard APIs.
