CREATE TABLE IF NOT EXISTS iphone_memory_limit_runs (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS iphone_memory_limit_runs_updated_at_idx
  ON iphone_memory_limit_runs (updated_at DESC);
