CREATE TABLE IF NOT EXISTS layer_compression_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS layer_compression_runs_created_at_idx
  ON layer_compression_runs (created_at DESC);
