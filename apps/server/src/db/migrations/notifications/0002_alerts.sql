-- Notification report of 2026-11-07 (18 section 11, amended): goals and progress get separate switches,
-- recurring expenses and vehicle service get their own, and two kinds are added: slip_season (collect
-- the tax slips the platforms send) and service_due (a vehicle's service interval is reached).
ALTER TABLE notification_prefs ADD COLUMN progress INTEGER NOT NULL DEFAULT 1 CHECK (progress IN (0,1));
ALTER TABLE notification_prefs ADD COLUMN recurring_expenses INTEGER NOT NULL DEFAULT 1 CHECK (recurring_expenses IN (0,1));
ALTER TABLE notification_prefs ADD COLUMN vehicle_service INTEGER NOT NULL DEFAULT 1 CHECK (vehicle_service IN (0,1));
-- A driver who muted "Goals and progress" keeps badges and levels muted too.
UPDATE notification_prefs SET progress = goals;

-- The kind list is a CHECK, so the table is rebuilt with the two new kinds. Nothing points at it.
CREATE TABLE notifications_new (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  kind       TEXT    NOT NULL CHECK (kind IN ('badge','challenge','level_up','streak_freeze','streak_risk','goal_met','tax_deadline','slip_season','shift_reminder','backup_overdue','backup_failed','recurring_expense_due','service_due')),
  dedupe_key TEXT    NOT NULL,
  body_key   TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  read_at    INTEGER,
  dismissed_at INTEGER,
  UNIQUE (user_id, dedupe_key)
);
INSERT INTO notifications_new SELECT id, user_id, kind, dedupe_key, body_key, created_at, read_at, dismissed_at FROM notifications;
DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;
CREATE INDEX idx_notif_user ON notifications(user_id, created_at DESC);
