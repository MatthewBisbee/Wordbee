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
