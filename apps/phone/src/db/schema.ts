/**
 * `app.db` migrations (15 section 2.2, 11). Forward only, numbered from 1; the position in the
 * list is the `PRAGMA user_version` after it ran. Never edit an applied entry: add a new one.
 *
 * `diag_events` / `diag_state` (16 section 6.1) are not here: diagnostics keep their ring in the
 * key-value store until the diagnostics PRs move it.
 */
export interface Migration {
  version: number;
  sql: string;
}

const V1 = `
CREATE TABLE sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE settings_cache (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  country       TEXT NOT NULL, distance_unit TEXT NOT NULL, currency TEXT NOT NULL,
  timezone      TEXT NOT NULL, stops_enabled INTEGER NOT NULL DEFAULT 1,
  modules_json  TEXT NOT NULL, fetched_at INTEGER NOT NULL
);

CREATE TABLE vehicles (
  server_id   INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  archived_at INTEGER
);

CREATE TABLE shifts (
  client_id       TEXT PRIMARY KEY,
  server_id       INTEGER UNIQUE,
  vehicle_id      INTEGER NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('active','ended','finalized')),
  segmenter       TEXT NOT NULL CHECK (segmenter IN ('stops','whole_shift')),
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  local_date      TEXT NOT NULL,
  total_m INTEGER, active_m INTEGER, deadhead_m INTEGER, personal_m INTEGER,
  calc_version    INTEGER,
  input_digest    TEXT,
  flags_json      TEXT,
  interruptions_json TEXT,
  calc_source     TEXT NOT NULL DEFAULT 'phone' CHECK (calc_source IN ('phone','server')),
  server_total_m  INTEGER,
  recon_status    TEXT NOT NULL DEFAULT 'pending'
                  CHECK (recon_status IN ('pending','match','differs','phone_missing')),
  recon_reasons   TEXT,
  first_seq INTEGER, last_seq INTEGER, point_count INTEGER,
  route_geojson   TEXT,
  notes           TEXT,
  updated_at      INTEGER NOT NULL,
  sync_state      TEXT NOT NULL DEFAULT 'local'
                  CHECK (sync_state IN ('local','syncing','on_server','needs_attention'))
);
CREATE INDEX idx_shifts_started ON shifts(started_at);
CREATE INDEX idx_shifts_sync ON shifts(sync_state);

CREATE TABLE stops (
  stop_key     TEXT PRIMARY KEY,
  shift_client_id TEXT NOT NULL REFERENCES shifts(client_id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL, dwell_s INTEGER NOT NULL,
  lat_e7 INTEGER NOT NULL, lon_e7 INTEGER NOT NULL,
  confidence   TEXT NOT NULL CHECK (confidence IN ('low','medium','high')),
  est_role     TEXT NOT NULL CHECK (est_role IN ('pickup','dropoff','none')),
  role         TEXT NOT NULL CHECK (role IN ('pickup','dropoff','other','none'))
);
CREATE INDEX idx_stops_shift ON stops(shift_client_id, started_at);

CREATE TABLE trips (
  trip_key    TEXT PRIMARY KEY,
  server_id   INTEGER UNIQUE,
  shift_client_id TEXT NOT NULL REFERENCES shifts(client_id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('active','deadhead','personal')),
  original_kind TEXT NOT NULL CHECK (original_kind IN ('active','deadhead')),
  source      TEXT NOT NULL CHECK (source IN ('auto','manual')),
  started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL,
  start_lat_e7 INTEGER, start_lon_e7 INTEGER, end_lat_e7 INTEGER, end_lon_e7 INTEGER,
  distance_m  INTEGER NOT NULL,
  purpose     TEXT NOT NULL,
  edited_at   INTEGER,
  sync_state  TEXT NOT NULL DEFAULT 'local'
);
CREATE INDEX idx_trips_shift ON trips(shift_client_id, started_at);

CREATE TABLE odometer_readings (
  shift_client_id TEXT NOT NULL REFERENCES shifts(client_id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('shift_start','shift_end')),
  reading_m   INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  sync_state  TEXT NOT NULL DEFAULT 'local',
  PRIMARY KEY (shift_client_id, kind)
);

CREATE TABLE outbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL CHECK (kind IN
             ('shift.create','shift.patch','odometer.put','trip.override','trip.manual','shift.end','diag.batch','capture.batch')),
  entity_key TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','parked','done'))
);
CREATE INDEX idx_outbox_pending ON outbox(status, id);

CREATE TABLE conflict_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         INTEGER NOT NULL,
  entity     TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  reason     TEXT NOT NULL CHECK (reason IN
             ('superseded_by_server','deleted_on_server','recon_diff','points_missing','calc_version')),
  local_json TEXT NOT NULL,
  server_json TEXT,
  seen       INTEGER NOT NULL DEFAULT 0
);
`;

export const MIGRATIONS: Migration[] = [{ version: 1, sql: V1 }];
