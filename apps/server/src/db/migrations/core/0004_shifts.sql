CREATE TABLE shifts (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  client_id     TEXT    NOT NULL,
  vehicle_id    INTEGER NOT NULL REFERENCES vehicles(id),
  status        TEXT    NOT NULL CHECK (status IN ('active','ended','finalized')),
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  local_date    TEXT    NOT NULL,
  total_m       INTEGER,
  active_m      INTEGER,
  deadhead_m    INTEGER,
  personal_m    INTEGER,
  segmenter     TEXT    NOT NULL CHECK (segmenter IN ('stops','whole_shift')),
  calc_version  INTEGER,
  calculated_at INTEGER,
  notes         TEXT,
  updated_at    INTEGER NOT NULL,
  recon_status  TEXT    NOT NULL DEFAULT 'pending' CHECK (recon_status IN ('pending','match','differs','phone_missing')),
  recon_reasons TEXT,
  phone_total_m INTEGER,
  phone_calc_version INTEGER,
  input_digest  TEXT,
  calc_mismatch INTEGER NOT NULL DEFAULT 0,
  interruptions_json TEXT,
  device_touched_at INTEGER,
  overlaps_shift_id INTEGER REFERENCES shifts(id),
  UNIQUE (user_id, client_id)
);
CREATE UNIQUE INDEX idx_shifts_one_active ON shifts(user_id) WHERE status = 'active';
CREATE INDEX idx_shifts_user_started ON shifts(user_id, started_at);
CREATE INDEX idx_shifts_user_date ON shifts(user_id, local_date);
