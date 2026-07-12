#!/usr/bin/env python3
"""Report Friends & Family player-activity stats.

Run it on the Pi against the live database (read-only — it never writes):

    python3 scripts/player_stats.py            # summary + last 14 active days
    python3 scripts/player_stats.py --days 30  # show the last 30 active days
    python3 scripts/player_stats.py --by-game  # add a per-game breakdown

"Players" = distinct Friends & Family users. A day is counted from a play's
local completion timestamp, pooling Wordle and every other game together. The
headline number is the average number of distinct people who play on a day.
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def get_db_path() -> Path:
    sys.path.insert(0, str(_repo_root()))
    from backend.app.config import load_env_file

    load_env_file()
    db_path_env = os.environ.get("DATABASE_PATH")
    if db_path_env:
        path = Path(db_path_env)
        if not path.is_absolute():
            path = _repo_root() / db_path_env
        return path
    return _repo_root() / "data" / "wordbee.sqlite"


def connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def load_activity(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    """One row per completed play (Wordle + all other games), with its local day."""
    return conn.execute(
        """
        SELECT substr(completed_at, 1, 10) AS day, user_id, play_type, 'wordle' AS game_key
        FROM friends_family_daily_results
        UNION ALL
        SELECT substr(completed_at, 1, 10) AS day, user_id, play_type, game_key
        FROM friends_family_game_results
        """
    ).fetchall()


def mean(values: list[int]) -> float:
    return sum(values) / len(values) if values else 0.0


def main() -> int:
    parser = argparse.ArgumentParser(description="Friends & Family player-activity stats.")
    parser.add_argument("--days", type=int, default=14, help="How many recent active days to list (default 14).")
    parser.add_argument("--by-game", action="store_true", help="Also print a per-game breakdown.")
    args = parser.parse_args()

    db_path = get_db_path()
    if not db_path.exists():
        print(f"Database not found at {db_path}", file=sys.stderr)
        return 1

    conn = connect(db_path)
    try:
        registered = conn.execute("SELECT COUNT(*) AS n FROM friends_family_users").fetchone()["n"]
        activity = load_activity(conn)
    finally:
        conn.close()

    if not activity:
        print(f"Database: {db_path}")
        print(f"Registered users: {registered}")
        print("No plays recorded yet.")
        return 0

    players_by_day: dict[str, set[str]] = defaultdict(set)
    daily_players_by_day: dict[str, set[str]] = defaultdict(set)
    plays_by_day: dict[str, int] = defaultdict(int)
    ever_played: set[str] = set()
    plays_by_game: dict[str, int] = defaultdict(int)
    players_by_game: dict[str, set[str]] = defaultdict(set)

    for row in activity:
        day = row["day"]
        user_id = row["user_id"]
        players_by_day[day].add(user_id)
        plays_by_day[day] += 1
        ever_played.add(user_id)
        if row["play_type"] == "daily":
            daily_players_by_day[day].add(user_id)
        plays_by_game[row["game_key"]] += 1
        players_by_game[row["game_key"]].add(user_id)

    days_sorted = sorted(players_by_day)
    per_day_counts = [len(players_by_day[day]) for day in days_sorted]

    def avg_over(days: list[str]) -> float:
        return mean([len(players_by_day[day]) for day in days])

    peak_day = max(days_sorted, key=lambda day: len(players_by_day[day]))

    print(f"Database: {db_path}")
    print(f"Date range: {days_sorted[0]} -> {days_sorted[-1]}  ({len(days_sorted)} active days)")
    print()
    print(f"Registered users:            {registered}")
    print(f"Users who have ever played:  {len(ever_played)}")
    print()
    print(f"Average daily players:            {avg_over(days_sorted):.1f}")
    print(f"  last 7 active days:             {avg_over(days_sorted[-7:]):.1f}")
    print(f"  last 30 active days:            {avg_over(days_sorted[-30:]):.1f}")
    print(f"Peak day:                         {len(players_by_day[peak_day])} players on {peak_day}")
    print(f"Average plays per day:            {mean(list(plays_by_day.values())):.1f}")

    recent = days_sorted[-args.days :]
    print()
    print(f"Last {len(recent)} active days:")
    print(f"  {'Day':<12}{'Players':>9}{'Daily':>8}{'Plays':>8}")
    for day in recent:
        print(
            f"  {day:<12}{len(players_by_day[day]):>9}"
            f"{len(daily_players_by_day[day]):>8}{plays_by_day[day]:>8}"
        )

    if args.by_game:
        print()
        print("By game (all time):")
        print(f"  {'Game':<14}{'Players':>9}{'Plays':>8}")
        for game_key in sorted(plays_by_game, key=lambda key: plays_by_game[key], reverse=True):
            print(f"  {game_key:<14}{len(players_by_game[game_key]):>9}{plays_by_game[game_key]:>8}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
