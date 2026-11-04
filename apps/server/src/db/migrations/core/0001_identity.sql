CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE TABLE settings (
  user_id            INTEGER PRIMARY KEY REFERENCES users(id),
  country            TEXT    NOT NULL CHECK (length(country) = 2),
  distance_unit      TEXT    NOT NULL CHECK (distance_unit IN ('km','mi')),
  currency           TEXT    NOT NULL CHECK (length(currency) = 3),
  timezone           TEXT    NOT NULL,
  raw_retention_days INTEGER NOT NULL DEFAULT 90 CHECK (raw_retention_days >= 7),
  stops_enabled      INTEGER NOT NULL DEFAULT 1 CHECK (stops_enabled IN (0,1)),
  diagnostics_level  TEXT    NOT NULL DEFAULT 'basic' CHECK (diagnostics_level IN ('off','basic','verbose')),
  diagnostics_verbose_until   INTEGER,
  offsite_last_download_at    INTEGER,
  offsite_synced_elsewhere_at INTEGER,
  updated_at         INTEGER NOT NULL
);
CREATE TABLE instance (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  instance_id        TEXT    NOT NULL,
  restore_generation INTEGER NOT NULL DEFAULT 0
);
