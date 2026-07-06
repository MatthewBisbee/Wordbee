# Wordbee Backend

This directory contains the Flask + SQLite backend for Wordbee. Wordle is the currently implemented game.

The current backend fetches and caches the daily Wordle answer, exposes the game metadata API, scores guesses, validates friends-and-family access, preserves each fetched answer by date in SQLite, and tracks friends-and-family-only daily Wordle stats.

Current responsibilities:

- Serve daily Wordle metadata without exposing the answer up front.
- Fetch and cache one official daily Wordle answer per date, with official historical play starting on `2021-06-19`.
- Resolve the active daily date in the configured puzzle timezone, defaulting to `America/Chicago`.
- Keep development fallback answers out of the historical cache.
- Score guesses server-side.
- Validate friends-and-family access codes without exposing private codes to the client.
- Keep one active friends-and-family session per user.
- Store one completed daily Wordle result per friends-and-family user per puzzle date.
- Expose family overview, player, daily-review, starter-word, leaderboard, trend, skill/luck, and solve-path stats.
- Lock current-day answer, guesses, board, and analysis data in stats until the requesting user has solved the current daily Wordle.
- Store fetched daily Wordle answers in SQLite for a future archive replayer.

Planned responsibilities:

- Expose daily and all-time leaderboard APIs.
