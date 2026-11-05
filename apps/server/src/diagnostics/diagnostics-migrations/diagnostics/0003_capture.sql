-- diagnostics.db, module `capture` (16 section 7.1). Soft references only: device and shift ids are plain values.
CREATE TABLE capture_sessions (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  device_id   INTEGER NOT NULL,
  profile     TEXT    NOT NULL CHECK (profile IN ('dense')),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  max_shifts  INTEGER NOT NULL
);
CREATE TABLE capture_fixes (
  capture_id      INTEGER NOT NULL,
  seq             INTEGER NOT NULL,
  shift_client_id TEXT    NOT NULL,
  recorded_at     INTEGER NOT NULL,
  lat_e7          INTEGER NOT NULL,
  lon_e7          INTEGER NOT NULL,
  accuracy_m      INTEGER NOT NULL,
  speed_dmps      INTEGER,
  bearing_deg     INTEGER,
  altitude_m      INTEGER,
  PRIMARY KEY (capture_id, seq)
) WITHOUT ROWID;
CREATE TABLE capture_annotations (
  capture_id      INTEGER NOT NULL,
  client_id       TEXT    NOT NULL,
  at              INTEGER NOT NULL,
  kind            TEXT    NOT NULL CHECK (kind IN ('real_stop','false_stop','missed_stop','event','note')),
  shift_client_id TEXT,
  stop_key        TEXT,
  text            TEXT,
  PRIMARY KEY (capture_id, client_id)
) WITHOUT ROWID;
