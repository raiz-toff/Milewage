CREATE TABLE trip_overrides (
  user_id   INTEGER NOT NULL REFERENCES users(id),
  shift_id  INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  trip_key  TEXT    NOT NULL,
  kind      TEXT    NOT NULL CHECK (kind IN ('active','deadhead','personal')),
  purpose   TEXT    NOT NULL,
  edited_at INTEGER NOT NULL,
  device_id INTEGER REFERENCES devices(id),
  PRIMARY KEY (shift_id, trip_key)
);
