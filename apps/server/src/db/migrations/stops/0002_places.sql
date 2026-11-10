-- ADR 0008: named places. A place is a name, a centre and a radius the driver saves on the web;
-- a detected stop inside it shows its name and, unless the driver labelled the stop by hand, takes
-- its label (role). Places are location data: they stay in this database (and so in every backup)
-- and are never written to diagnostics or logs.
CREATE TABLE places (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  name       TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  lat_e7     INTEGER NOT NULL CHECK (lat_e7 BETWEEN -900000000 AND 900000000),
  lon_e7     INTEGER NOT NULL CHECK (lon_e7 BETWEEN -1800000000 AND 1800000000),
  radius_m   INTEGER NOT NULL CHECK (radius_m BETWEEN 25 AND 1000),
  role       TEXT    NOT NULL CHECK (role IN ('pickup','dropoff','other')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_places_user ON places(user_id);

-- The place a stop was inside when the engine last ran on its shift (null: none). A finalized
-- shift keeps what was matched then; a deleted place leaves its stops without one.
ALTER TABLE stops ADD COLUMN place_id INTEGER REFERENCES places(id) ON DELETE SET NULL;
