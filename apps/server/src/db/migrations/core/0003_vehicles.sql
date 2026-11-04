CREATE TABLE vehicles (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  name        TEXT    NOT NULL,
  kind        TEXT    NOT NULL CHECK (kind IN ('car','motorcycle','van','bicycle')),
  created_at  INTEGER NOT NULL,
  archived_at INTEGER
);
