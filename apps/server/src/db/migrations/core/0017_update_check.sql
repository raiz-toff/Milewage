-- The update check (ADR-free, DECISIONS 2026-11-22): the owner's switch, and what the last check
-- found. One row; no data about the owner is kept or sent.
ALTER TABLE settings ADD COLUMN update_check_enabled INTEGER NOT NULL DEFAULT 1 CHECK (update_check_enabled IN (0,1));
CREATE TABLE update_check (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  attempted_at INTEGER NOT NULL,
  succeeded_at INTEGER,
  latest_version TEXT,
  release_url TEXT,
  error TEXT
);
