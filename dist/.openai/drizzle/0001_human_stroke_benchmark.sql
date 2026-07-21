CREATE TABLE IF NOT EXISTS human_stroke_benchmark (
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'canonical'),
  payload_json TEXT NOT NULL,
  captured_at TEXT NOT NULL
);
