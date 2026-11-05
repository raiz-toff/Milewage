-- 18 section 9: planned shifts, repeating templates and off days. A plan is not a record: a worked
-- shift stays the contemporaneous record. Entries are created only when asked (expand), never by a job.
CREATE TABLE schedule_templates (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  label      TEXT    NOT NULL,
  weekdays   INTEGER NOT NULL CHECK (weekdays BETWEEN 1 AND 127),
  start_time TEXT    NOT NULL,
  end_time   TEXT    NOT NULL,
  platform   TEXT,
  vehicle_id INTEGER REFERENCES vehicles(id),
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);
CREATE TABLE schedule_entries (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  planned_on  TEXT    NOT NULL,
  start_time  TEXT    NOT NULL,
  end_time    TEXT    NOT NULL,
  platform    TEXT,
  vehicle_id  INTEGER REFERENCES vehicles(id),
  template_id INTEGER REFERENCES schedule_templates(id) ON DELETE SET NULL,
  shift_id    INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  remind      INTEGER NOT NULL DEFAULT 1 CHECK (remind IN (0,1)),
  UNIQUE (user_id, planned_on, start_time)
);
CREATE TABLE schedule_off_days (
  user_id INTEGER NOT NULL REFERENCES users(id),
  off_on  TEXT    NOT NULL,
  note    TEXT,
  PRIMARY KEY (user_id, off_on)
);
