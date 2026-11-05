-- 18 section 4.3: one row per shift and platform, typed by the driver after the fact. Never a
-- per-delivery tap and never written by the phone.
CREATE TABLE shift_earnings (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  shift_id    INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  platform    TEXT    NOT NULL DEFAULT 'other',
  gross_cents INTEGER NOT NULL DEFAULT 0 CHECK (gross_cents >= 0),
  tips_cents  INTEGER NOT NULL DEFAULT 0 CHECK (tips_cents  >= 0),
  bonus_cents INTEGER NOT NULL DEFAULT 0 CHECK (bonus_cents >= 0),
  orders      INTEGER CHECK (orders IS NULL OR orders >= 0),
  online_min  INTEGER CHECK (online_min IS NULL OR online_min >= 0),
  notes       TEXT,
  source      TEXT    NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import')),
  edited_at   INTEGER NOT NULL,
  UNIQUE (shift_id, platform)
);
CREATE INDEX idx_earn_user_shift ON shift_earnings(user_id, shift_id);
