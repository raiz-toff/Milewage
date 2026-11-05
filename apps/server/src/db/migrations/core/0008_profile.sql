-- migrate: foreign_keys=off
-- 18 section 4.1: vehicle details, three more kinds, and the profile fields of the settings.
-- The kind CHECK cannot be widened in place, so the table is rebuilt (18 section 4.1).
CREATE TABLE vehicles_new (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  name        TEXT    NOT NULL,
  kind        TEXT    NOT NULL CHECK (kind IN ('car','motorcycle','van','bicycle','ebike','scooter','walking')),
  make        TEXT,
  model       TEXT,
  year        INTEGER CHECK (year IS NULL OR year BETWEEN 1900 AND 2100),
  plate       TEXT,
  power       TEXT    CHECK (power IS NULL OR power IN ('gas','hybrid','ev','other')),
  created_at  INTEGER NOT NULL,
  archived_at INTEGER
);
INSERT INTO vehicles_new (id, user_id, name, kind, created_at, archived_at)
  SELECT id, user_id, name, kind, created_at, archived_at FROM vehicles;
DROP TABLE vehicles;
ALTER TABLE vehicles_new RENAME TO vehicles;

ALTER TABLE settings ADD COLUMN display_name       TEXT;
ALTER TABLE settings ADD COLUMN region             TEXT;
ALTER TABLE settings ADD COLUMN week_start         INTEGER NOT NULL DEFAULT 1 CHECK (week_start IN (0,1));
ALTER TABLE settings ADD COLUMN time_format        TEXT    NOT NULL DEFAULT '24h' CHECK (time_format IN ('12h','24h'));
ALTER TABLE settings ADD COLUMN default_vehicle_id INTEGER REFERENCES vehicles(id);
