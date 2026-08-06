CREATE TABLE IF NOT EXISTS vector_zoom_runs (
  run_code TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
