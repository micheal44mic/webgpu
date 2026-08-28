ALTER TABLE gpu_startup_diagnostic_runs
  ADD COLUMN latest_event TEXT NOT NULL DEFAULT 'html-requested';

ALTER TABLE gpu_startup_diagnostic_runs
  ADD COLUMN result_summary TEXT NOT NULL DEFAULT '';

ALTER TABLE gpu_startup_diagnostic_runs
  ADD COLUMN payload_bytes INTEGER NOT NULL DEFAULT 0;
