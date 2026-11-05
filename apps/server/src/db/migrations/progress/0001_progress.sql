-- 18 section 8.2: only stable facts are stored. XP, level, streak and challenge progress are
-- derived from shifts, earnings and distance every time. A completed weekly challenge is a
-- badge_unlocks row with a slug of the form challenge:<id>:<week start>.
CREATE TABLE badge_unlocks (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  badge       TEXT    NOT NULL,
  unlocked_at INTEGER NOT NULL,
  shift_id    INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, badge)
);
CREATE TABLE progress_state (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id),
  freezes_held     INTEGER NOT NULL DEFAULT 0 CHECK (freezes_held BETWEEN 0 AND 3),
  freezes_used_on  TEXT    NOT NULL DEFAULT '[]',
  levels_rewarded  INTEGER NOT NULL DEFAULT 0
);
