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
