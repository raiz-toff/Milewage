CREATE TABLE stops (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  shift_id   INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  stop_key   TEXT    NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at   INTEGER NOT NULL,
  dwell_s    INTEGER NOT NULL CHECK (dwell_s >= 0),
  lat_e7     INTEGER NOT NULL, lon_e7 INTEGER NOT NULL,
  confidence TEXT    NOT NULL CHECK (confidence IN ('low','medium','high')),
  est_role   TEXT    NOT NULL CHECK (est_role IN ('pickup','dropoff','none')),
  role       TEXT    NOT NULL CHECK (role IN ('pickup','dropoff','other','none')),
  UNIQUE (shift_id, stop_key)
);
CREATE INDEX idx_stops_shift ON stops(shift_id, started_at);

CREATE TABLE stop_labels (
  user_id      INTEGER NOT NULL REFERENCES users(id),
  shift_id     INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  stop_key     TEXT    NOT NULL,
  role         TEXT    NOT NULL CHECK (role IN ('pickup','dropoff','other')),
  platform     TEXT,
  place        TEXT,
  payout_cents INTEGER NOT NULL DEFAULT 0 CHECK (payout_cents >= 0),
  tip_cents    INTEGER NOT NULL DEFAULT 0 CHECK (tip_cents >= 0),
  notes        TEXT,
  edited_at    INTEGER NOT NULL,
  PRIMARY KEY (shift_id, stop_key)
);
