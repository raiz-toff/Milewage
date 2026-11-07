-- Service reminders (notification report of 2026-11-07): "every N km and/or every M months" per
-- vehicle and service kind. Due is derived when read, from the last entry of that kind (or the day the
-- reminder was set) and the distance driven since; nothing about "due" is stored.
CREATE TABLE service_intervals (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  vehicle_id  INTEGER NOT NULL REFERENCES vehicles(id),
  kind        TEXT    NOT NULL CHECK (kind IN ('oil_change','tires','brakes','other')),
  every_m     INTEGER CHECK (every_m IS NULL OR every_m > 0),
  every_months INTEGER CHECK (every_months IS NULL OR every_months BETWEEN 1 AND 120),
  since_on    TEXT    NOT NULL,   -- local date the reminder was set: the start when no entry of this kind exists
  created_at  INTEGER NOT NULL,
  CHECK (every_m IS NOT NULL OR every_months IS NOT NULL),
  UNIQUE (vehicle_id, kind)
);
