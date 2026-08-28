CREATE TABLE IF NOT EXISTS gpu_startup_diagnostic_runs (
  run_code TEXT PRIMARY KEY NOT NULL,
  write_token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS gpu_startup_diagnostic_runs_expires_at_idx
  ON gpu_startup_diagnostic_runs (expires_at);
