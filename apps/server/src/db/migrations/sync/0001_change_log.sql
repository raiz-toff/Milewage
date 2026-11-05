CREATE TABLE change_log (
  seq     INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  entity  TEXT    NOT NULL,
  key     TEXT    NOT NULL,
  op      TEXT    NOT NULL CHECK (op IN ('upsert','delete')),
  at      INTEGER NOT NULL
);
CREATE INDEX idx_change_log_at ON change_log(at);
CREATE INDEX idx_change_log_key ON change_log(entity, key);

CREATE TABLE overwrite_log (
  id              INTEGER PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  at              INTEGER NOT NULL,
  entity          TEXT    NOT NULL,
  key             TEXT    NOT NULL,
  superseded_json TEXT    NOT NULL,
  by_device_id    INTEGER REFERENCES devices(id)
);
