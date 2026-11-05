CREATE TABLE route_archives (
  shift_id         INTEGER PRIMARY KEY REFERENCES shifts(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  geometry         TEXT    NOT NULL,
  raw_point_count  INTEGER NOT NULL,
  kept_point_count INTEGER NOT NULL,
  tolerance_m      INTEGER NOT NULL,
  archived_at      INTEGER NOT NULL
);
