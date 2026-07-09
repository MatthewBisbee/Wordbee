CREATE TABLE IF NOT EXISTS daily_answers (
  puzzle_date TEXT PRIMARY KEY,
  answer TEXT NOT NULL,
  answer_length INTEGER NOT NULL,
  confidence REAL NOT NULL,
  status TEXT NOT NULL,
  source_count INTEGER NOT NULL,
  sources_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_daily_answers_fetched_at
ON daily_answers (fetched_at);

CREATE TABLE IF NOT EXISTS completed_games (
  id TEXT PRIMARY KEY,
  puzzle_date TEXT NOT NULL,
  mode TEXT NOT NULL,
  outcome TEXT NOT NULL,
  guesses_used INTEGER NOT NULL,
  hard_mode INTEGER NOT NULL,
  board_json TEXT NOT NULL,
  completed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_completed_games_mode_completed_at
ON completed_games (mode, completed_at);

CREATE INDEX IF NOT EXISTS idx_completed_games_puzzle_date
ON completed_games (puzzle_date);

CREATE TABLE IF NOT EXISTS friends_family_users (
  id TEXT PRIMARY KEY,
  code_id TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_initial TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_json TEXT,
  active_session_id TEXT,
  active_client_session_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (code_id, first_name, last_initial)
);

CREATE INDEX IF NOT EXISTS idx_friends_family_users_code_name
ON friends_family_users (code_id, first_name, last_initial);

CREATE TABLE IF NOT EXISTS friends_family_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_session_id TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES friends_family_users (id)
);

CREATE INDEX IF NOT EXISTS idx_friends_family_sessions_user_created
ON friends_family_sessions (user_id, created_at);

CREATE TABLE IF NOT EXISTS friends_family_daily_results (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  puzzle_date TEXT NOT NULL,
  answer TEXT NOT NULL,
  outcome TEXT NOT NULL,
  guesses_used INTEGER NOT NULL,
  starter_word TEXT NOT NULL,
  guesses_json TEXT NOT NULL,
  board_json TEXT NOT NULL,
  play_type TEXT NOT NULL DEFAULT 'daily',
  completed_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES friends_family_users (id),
  UNIQUE (user_id, puzzle_date)
);

CREATE INDEX IF NOT EXISTS idx_friends_family_daily_results_user_date
ON friends_family_daily_results (user_id, puzzle_date);

CREATE INDEX IF NOT EXISTS idx_friends_family_daily_results_date
ON friends_family_daily_results (puzzle_date);

CREATE TABLE IF NOT EXISTS friends_family_daily_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  puzzle_date TEXT NOT NULL,
  guesses_json TEXT NOT NULL,
  board_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES friends_family_users (id),
  UNIQUE (user_id, puzzle_date)
);

CREATE INDEX IF NOT EXISTS idx_friends_family_daily_attempts_user_date
ON friends_family_daily_attempts (user_id, puzzle_date);

-- Write-once cache of the (CPU-intensive) Wordle solve analysis per completed
-- result. Kept in its own table so the core results table stays untouched; a
-- result is immutable once written, so a cached analysis never goes stale.
CREATE TABLE IF NOT EXISTS friends_family_daily_analysis (
  result_id TEXT PRIMARY KEY,
  analysis_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (result_id) REFERENCES friends_family_daily_results (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS word_definitions (
  word TEXT PRIMARY KEY,
  phonetic TEXT,
  part_of_speech TEXT,
  definition TEXT NOT NULL,
  example TEXT,
  synonyms_json TEXT NOT NULL,
  source_url TEXT,
  fetched_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_connections (
  puzzle_date TEXT PRIMARY KEY,
  external_id TEXT,
  editor TEXT,
  cards_json TEXT NOT NULL,
  groups_json TEXT NOT NULL,
  status TEXT NOT NULL,
  source_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_strands (
  puzzle_date TEXT PRIMARY KEY,
  external_id TEXT,
  editor TEXT,
  constructors TEXT,
  clue TEXT NOT NULL,
  board_json TEXT NOT NULL,
  theme_words_json TEXT NOT NULL,
  spangram TEXT NOT NULL,
  theme_paths_json TEXT NOT NULL,
  spangram_path_json TEXT NOT NULL,
  allowed_words_json TEXT NOT NULL,
  status TEXT NOT NULL,
  source_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_sudoku (
  puzzle_date TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  external_id TEXT,
  display_date TEXT NOT NULL,
  puzzle_json TEXT NOT NULL,
  solution_json TEXT NOT NULL,
  status TEXT NOT NULL,
  source_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (puzzle_date, difficulty)
);

CREATE TABLE IF NOT EXISTS friends_family_game_results (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  game_key TEXT NOT NULL,
  puzzle_date TEXT NOT NULL,
  puzzle_variant TEXT NOT NULL,
  outcome TEXT NOT NULL,
  elapsed_seconds INTEGER,
  score_json TEXT NOT NULL,
  play_type TEXT NOT NULL DEFAULT 'daily',
  completed_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES friends_family_users (id),
  UNIQUE (user_id, game_key, puzzle_date, puzzle_variant)
);

CREATE INDEX IF NOT EXISTS idx_friends_family_game_results_user_game_date
ON friends_family_game_results (user_id, game_key, puzzle_date);

CREATE INDEX IF NOT EXISTS idx_friends_family_game_results_game_date
ON friends_family_game_results (game_key, puzzle_date);

CREATE TABLE IF NOT EXISTS friends_family_game_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  game_key TEXT NOT NULL,
  puzzle_date TEXT NOT NULL,
  puzzle_variant TEXT NOT NULL,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES friends_family_users (id),
  UNIQUE (user_id, game_key, puzzle_date, puzzle_variant)
);

CREATE INDEX IF NOT EXISTS idx_friends_family_game_attempts_user_game_date
ON friends_family_game_attempts (user_id, game_key, puzzle_date, puzzle_variant);

-- Tracks the local archive backfill: which (game, date) puzzles have been
-- downloaded into the per-game caches and whether they are the real puzzle
-- (confirmed), a fallback (generated), unavailable (missing), or errored. The
-- puzzle data itself lives in the daily_* caches (and letterboxed.sqlite); this
-- is the index/progress ledger that makes bulk download resumable.
CREATE TABLE IF NOT EXISTS archive_status (
  game_key TEXT NOT NULL,
  puzzle_date TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  note TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT NOT NULL,
  PRIMARY KEY (game_key, puzzle_date, variant)
);

CREATE INDEX IF NOT EXISTS idx_archive_status_game_status
ON archive_status (game_key, status);
