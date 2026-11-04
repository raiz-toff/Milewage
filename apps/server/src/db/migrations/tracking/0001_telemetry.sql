CREATE TABLE telemetry_points (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  device_id   INTEGER NOT NULL REFERENCES devices(id),
  seq         INTEGER NOT NULL,
  shift_id    INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  recorded_at INTEGER NOT NULL,
  lat_e7      INTEGER NOT NULL CHECK (lat_e7 BETWEEN -900000000 AND 900000000),
  lon_e7      INTEGER NOT NULL CHECK (lon_e7 BETWEEN -1800000000 AND 1800000000),
  accuracy_m  INTEGER NOT NULL,
  speed_dmps  INTEGER,
  bearing_deg INTEGER,
  altitude_m  INTEGER,
  UNIQUE (device_id, seq)
);
CREATE INDEX idx_points_shift_time ON telemetry_points(shift_id, recorded_at);
