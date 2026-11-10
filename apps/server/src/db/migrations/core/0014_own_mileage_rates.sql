-- ADR 0007: your mileage rate has dates and may replace the country's rate. Each row is in force
-- from its date until the next one; a null date means "from the start", the undated rate a driver
-- set before 0.3.0 (core 0009), which is carried over here unchanged. Hundredths of a minor unit
-- per km or mile. use_own_rate starts off for everyone, so no deduction changes on upgrade: where
-- the country has no rates the own rate applies without it, as before (plan 21 Q5).
CREATE TABLE own_mileage_rates (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  effective_from TEXT    CHECK (effective_from IS NULL OR effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  hundredths     INTEGER NOT NULL CHECK (hundredths > 0),
  unit           TEXT    NOT NULL CHECK (unit IN ('km','mi')),
  note           TEXT    CHECK (note IS NULL OR length(note) <= 200),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
-- One rate per day, and one undated rate (SQLite lets NULLs repeat in a plain UNIQUE).
CREATE UNIQUE INDEX idx_own_rates_day ON own_mileage_rates(user_id, COALESCE(effective_from, ''));

INSERT INTO own_mileage_rates (user_id, effective_from, hundredths, unit, note, created_at, updated_at)
  SELECT user_id, NULL, own_rate_hundredths, own_rate_unit, NULL, updated_at, updated_at
    FROM settings
   WHERE own_rate_hundredths IS NOT NULL AND own_rate_unit IS NOT NULL;

ALTER TABLE settings DROP COLUMN own_rate_hundredths;
ALTER TABLE settings DROP COLUMN own_rate_unit;
ALTER TABLE settings ADD COLUMN use_own_rate INTEGER NOT NULL DEFAULT 0 CHECK (use_own_rate IN (0,1));
