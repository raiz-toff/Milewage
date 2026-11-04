CREATE TABLE odometer_readings (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  vehicle_id  INTEGER NOT NULL REFERENCES vehicles(id),
  shift_id    INTEGER REFERENCES shifts(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL CHECK (kind IN ('shift_start','shift_end','year_start','year_end')),
  reading_m   INTEGER NOT NULL CHECK (reading_m >= 0),
  recorded_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_odo_shift_kind ON odometer_readings(shift_id, kind) WHERE shift_id IS NOT NULL;
CREATE INDEX idx_odo_vehicle_time ON odometer_readings(vehicle_id, recorded_at);
