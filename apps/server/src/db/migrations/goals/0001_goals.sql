-- 18 section 8.1: a goal is a metric, a period and a target. Progress is computed at read time.
-- Nothing is seeded: a default weekly target would be a fabricated number.
CREATE TABLE goals (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  label      TEXT    NOT NULL,
  metric     TEXT    NOT NULL CHECK (metric IN ('earnings','hours','shifts','active_distance')),
  period     TEXT    NOT NULL CHECK (period IN ('daily','weekly','monthly','yearly')),
  target     INTEGER NOT NULL CHECK (target > 0),
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_goals_user ON goals(user_id);
