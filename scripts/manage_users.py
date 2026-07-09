#!/usr/bin/env python3
"""Manage Friends & Family users: list, delete, or merge duplicate users with conflict resolution."""
from __future__ import annotations

import os
import sqlite3
import sys
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
            path = _repo_root() / path
        return path
    return _repo_root() / "data" / "wordbee.sqlite"

def connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn

def list_users(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, code_id, first_name, last_initial, display_name, created_at
        FROM friends_family_users
        ORDER BY display_name COLLATE NOCASE ASC
    """)
    users = cursor.fetchall()
    print("\n--- Current Users ---")
    if not users:
        print("No users found.")
        return []
    
    for i, u in enumerate(users, start=1):
        print(f"[{i}] Name: {u['display_name']} | Code: {u['code_id']} | ID: {u['id']} | Created: {u['created_at']}")
    return users

def delete_user(conn: sqlite3.Connection, user_id: str, display_name: str) -> None:
    confirm = input(f"\nAre you absolutely sure you want to delete user '{display_name}' ({user_id})? This will delete all of their sessions, results, and attempts! [y/N]: ").strip().lower()
    if confirm != 'y':
        print("Aborted.")
        return
    
    cursor = conn.cursor()
    try:
        conn.execute("BEGIN TRANSACTION")
        
        # Delete sessions
        cursor.execute("DELETE FROM friends_family_sessions WHERE user_id = ?", (user_id,))
        sessions_deleted = cursor.rowcount
        
        # Delete wordle results & attempts
        cursor.execute("DELETE FROM friends_family_daily_results WHERE user_id = ?", (user_id,))
        daily_results_deleted = cursor.rowcount
        cursor.execute("DELETE FROM friends_family_daily_attempts WHERE user_id = ?", (user_id,))
        daily_attempts_deleted = cursor.rowcount
        
        # Delete multi-game results & attempts
        cursor.execute("DELETE FROM friends_family_game_results WHERE user_id = ?", (user_id,))
        game_results_deleted = cursor.rowcount
        cursor.execute("DELETE FROM friends_family_game_attempts WHERE user_id = ?", (user_id,))
        game_attempts_deleted = cursor.rowcount
        
        # Delete user
        cursor.execute("DELETE FROM friends_family_users WHERE id = ?", (user_id,))
        
        conn.commit()
        print(f"\nSuccessfully deleted user '{display_name}' ({user_id}).")
        print(f"Cleaned up: {sessions_deleted} sessions, {daily_results_deleted} Wordle results, {daily_attempts_deleted} Wordle attempts, {game_results_deleted} game results, {game_attempts_deleted} game attempts.")
    except Exception as e:
        conn.rollback()
        print(f"Error during deletion: {e}")

def merge_users(conn: sqlite3.Connection, delete_user_id: str, keep_user_id: str, delete_name: str, keep_name: str) -> None:
    confirm = input(f"\nAre you sure you want to merge duplicate user '{delete_name}' ({delete_user_id}) into '{keep_name}' ({keep_user_id})?\nThis will delete '{delete_name}' and keep '{keep_name}' after resolving conflicts. [y/N]: ").strip().lower()
    if confirm != 'y':
        print("Aborted.")
        return
    
    cursor = conn.cursor()
    try:
        conn.execute("BEGIN TRANSACTION")
        
        # 1. Update/Merge Sessions
        cursor.execute("UPDATE friends_family_sessions SET user_id = ? WHERE user_id = ?", (keep_user_id, delete_user_id))
        sessions_merged = cursor.rowcount
        
        # 2. Merge Daily Wordle Results (friends_family_daily_results)
        cursor.execute("SELECT puzzle_date, completed_at, id FROM friends_family_daily_results WHERE user_id = ?", (keep_user_id,))
        keep_results = {row["puzzle_date"]: row for row in cursor.fetchall()}
        
        cursor.execute("SELECT puzzle_date, completed_at, id FROM friends_family_daily_results WHERE user_id = ?", (delete_user_id,))
        delete_results = cursor.fetchall()
        
        daily_results_kept = 0
        daily_results_deleted = 0
        
        for row in delete_results:
            p_date = row["puzzle_date"]
            completed_at_b = row["completed_at"]
            id_b = row["id"]
            
            if p_date in keep_results:
                completed_at_a = keep_results[p_date]["completed_at"]
                id_a = keep_results[p_date]["id"]
                
                # Keep completed first (earlier completed_at string)
                if completed_at_b < completed_at_a:
                    cursor.execute("DELETE FROM friends_family_daily_results WHERE id = ?", (id_a,))
                    cursor.execute("UPDATE friends_family_daily_results SET user_id = ? WHERE id = ?", (keep_user_id, id_b))
                    daily_results_kept += 1
                    daily_results_deleted += 1
                else:
                    cursor.execute("DELETE FROM friends_family_daily_results WHERE id = ?", (id_b,))
                    daily_results_deleted += 1
            else:
                cursor.execute("UPDATE friends_family_daily_results SET user_id = ? WHERE id = ?", (keep_user_id, id_b))
                daily_results_kept += 1
        
        # 3. Merge Daily Wordle Attempts (friends_family_daily_attempts)
        cursor.execute("SELECT puzzle_date, id FROM friends_family_daily_attempts WHERE user_id = ?", (keep_user_id,))
        keep_attempts = {row["puzzle_date"]: row["id"] for row in cursor.fetchall()}
        
        cursor.execute("SELECT puzzle_date, id FROM friends_family_daily_attempts WHERE user_id = ?", (delete_user_id,))
        delete_attempts = cursor.fetchall()
        
        for row in delete_attempts:
            p_date = row["puzzle_date"]
            id_b = row["id"]
            if p_date in keep_attempts:
                cursor.execute("DELETE FROM friends_family_daily_attempts WHERE id = ?", (id_b,))
            else:
                cursor.execute("UPDATE friends_family_daily_attempts SET user_id = ? WHERE id = ?", (keep_user_id, id_b))
        
        # 4. Merge Game Results (friends_family_game_results)
        cursor.execute("SELECT game_key, puzzle_date, puzzle_variant, completed_at, id FROM friends_family_game_results WHERE user_id = ?", (keep_user_id,))
        keep_game_res = {(row["game_key"], row["puzzle_date"], row["puzzle_variant"]): row for row in cursor.fetchall()}
        
        cursor.execute("SELECT game_key, puzzle_date, puzzle_variant, completed_at, id FROM friends_family_game_results WHERE user_id = ?", (delete_user_id,))
        delete_game_res = cursor.fetchall()
        
        game_results_kept = 0
        game_results_deleted = 0
        
        for row in delete_game_res:
            key = (row["game_key"], row["puzzle_date"], row["puzzle_variant"])
            completed_at_b = row["completed_at"]
            id_b = row["id"]
            
            if key in keep_game_res:
                completed_at_a = keep_game_res[key]["completed_at"]
                id_a = keep_game_res[key]["id"]
                
                if completed_at_b < completed_at_a:
                    cursor.execute("DELETE FROM friends_family_game_results WHERE id = ?", (id_a,))
                    cursor.execute("UPDATE friends_family_game_results SET user_id = ? WHERE id = ?", (keep_user_id, id_b))
                    game_results_kept += 1
                    game_results_deleted += 1
                else:
                    cursor.execute("DELETE FROM friends_family_game_results WHERE id = ?", (id_b,))
                    game_results_deleted += 1
            else:
                cursor.execute("UPDATE friends_family_game_results SET user_id = ? WHERE id = ?", (keep_user_id, id_b))
                game_results_kept += 1

        # 5. Merge Game Attempts (friends_family_game_attempts)
        cursor.execute("SELECT game_key, puzzle_date, puzzle_variant, id FROM friends_family_game_attempts WHERE user_id = ?", (keep_user_id,))
        keep_game_att = {(row["game_key"], row["puzzle_date"], row["puzzle_variant"]): row["id"] for row in cursor.fetchall()}
        
        cursor.execute("SELECT game_key, puzzle_date, puzzle_variant, id FROM friends_family_game_attempts WHERE user_id = ?", (delete_user_id,))
        delete_game_att = cursor.fetchall()
        
        for row in delete_game_att:
            key = (row["game_key"], row["puzzle_date"], row["puzzle_variant"])
            id_b = row["id"]
            if key in keep_game_att:
                cursor.execute("DELETE FROM friends_family_game_attempts WHERE id = ?", (id_b,))
            else:
                cursor.execute("UPDATE friends_family_game_attempts SET user_id = ? WHERE id = ?", (keep_user_id, id_b))
        
        # 6. Delete B from users
        cursor.execute("DELETE FROM friends_family_users WHERE id = ?", (delete_user_id,))
        
        conn.commit()
        print(f"\nSuccessfully merged user '{delete_name}' into '{keep_name}'.")
        print(f"Moved/merged: {sessions_merged} sessions, {daily_results_kept} Wordle results (with {daily_results_deleted} duplicates resolved), and {game_results_kept} game results (with {game_results_deleted} duplicates resolved).")
    except Exception as e:
        conn.rollback()
        print(f"Error during merge transaction: {e}")

def main() -> None:
    db_path = get_db_path()
    print(f"Connecting to database at: {db_path}")
    if not db_path.exists():
        print(f"Error: Database file does not exist at {db_path}.")
        sys.exit(1)
        
    conn = connect(db_path)
    try:
        while True:
            users = list_users(conn)
            print("\nOptions:")
            print("1. Refresh user list")
            print("2. Delete a user")
            print("3. Merge duplicate user (delete duplicate, merge stats)")
            print("4. Exit")
            
            choice = input("\nEnter choice [1-4]: ").strip()
            if choice == '1':
                continue
            elif choice == '2':
                if not users:
                    print("No users to delete.")
                    continue
                num = input(f"Enter user number [1-{len(users)}]: ").strip()
                try:
                    index = int(num) - 1
                    if 0 <= index < len(users):
                        u = users[index]
                        delete_user(conn, u["id"], u["display_name"])
                    else:
                        print("Invalid selection.")
                except ValueError:
                    print("Invalid input.")
            elif choice == '3':
                if len(users) < 2:
                    print("Need at least 2 users to perform a merge.")
                    continue
                num_del = input(f"Enter number of user to DELETE (duplicate) [1-{len(users)}]: ").strip()
                num_keep = input(f"Enter number of user to KEEP (target) [1-{len(users)}]: ").strip()
                try:
                    idx_del = int(num_del) - 1
                    idx_keep = int(num_keep) - 1
                    if idx_del == idx_keep:
                        print("Target and duplicate cannot be the same user!")
                        continue
                    if 0 <= idx_del < len(users) and 0 <= idx_keep < len(users):
                        u_del = users[idx_del]
                        u_keep = users[idx_keep]
                        merge_users(conn, u_del["id"], u_keep["id"], u_del["display_name"], u_keep["display_name"])
                    else:
                        print("Invalid selection.")
                except ValueError:
                    print("Invalid input.")
            elif choice == '4' or not choice:
                print("Exiting.")
                break
            else:
                print("Invalid choice.")
    finally:
        conn.close()

if __name__ == "__main__":
    main()
