-- 07 section 2.1, module `backup` (engine, not toggleable). One row per verified backup file.
CREATE TABLE backup_runs (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  trigger      TEXT    NOT NULL CHECK (trigger IN ('nightly','shift_end','manual','pre_migration','pre_restore')),
  file_name    TEXT    NOT NULL,
  size_bytes   INTEGER NOT NULL,
  sha256       TEXT    NOT NULL,
  integrity_ok INTEGER NOT NULL CHECK (integrity_ok IN (0,1))
);
CREATE INDEX idx_backup_runs_created ON backup_runs(created_at);
