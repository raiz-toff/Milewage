CREATE TABLE trips (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  shift_id      INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  trip_key      TEXT    NOT NULL,
  client_id     TEXT,
  kind          TEXT    NOT NULL CHECK (kind IN ('active','deadhead','personal')),
  original_kind TEXT    NOT NULL CHECK (original_kind IN ('active','deadhead')),
  source        TEXT    NOT NULL CHECK (source IN ('auto','manual')),
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER NOT NULL,
  start_lat_e7  INTEGER, start_lon_e7 INTEGER,
  end_lat_e7    INTEGER, end_lon_e7   INTEGER,
  distance_m    INTEGER NOT NULL CHECK (distance_m >= 0),
  purpose       TEXT    NOT NULL,
  edited_at     INTEGER
);
CREATE INDEX idx_trips_shift ON trips(shift_id, started_at);
CREATE INDEX idx_trips_user_started ON trips(user_id, started_at);
CREATE UNIQUE INDEX idx_trips_key ON trips(user_id, trip_key);
CREATE UNIQUE INDEX idx_trips_client ON trips(user_id, client_id) WHERE client_id IS NOT NULL;

CREATE TABLE shift_flags (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  shift_id   INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  code       TEXT    NOT NULL,
  severity   TEXT    NOT NULL CHECK (severity IN ('info','review')),
  detail     TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_shift_flags_shift ON shift_flags(shift_id);
