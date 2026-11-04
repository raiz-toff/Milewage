-- diagnostics.db, module `diagnostics` (16 section 7.1). Separate file: no foreign keys to milewage.db.
CREATE TABLE diag_events (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  src         TEXT    NOT NULL CHECK (src IN ('phone_native','phone_js','server','web')),
  device_id   INTEGER,
  seq         INTEGER,
  at          INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  level       TEXT    NOT NULL CHECK (level IN ('basic','verbose')),
  kind        TEXT    NOT NULL,
  shift_client_id TEXT,
  capture_id  INTEGER,
  app_v       TEXT,
  data        TEXT    NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_diag_phone_seq ON diag_events(device_id, src, seq) WHERE seq IS NOT NULL;
CREATE INDEX idx_diag_kind_time ON diag_events(kind, at);
CREATE INDEX idx_diag_shift ON diag_events(shift_client_id, at) WHERE shift_client_id IS NOT NULL;
CREATE INDEX idx_diag_expiry ON diag_events(expires_at);
