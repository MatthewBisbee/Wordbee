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
