-- 18 section 11: an in-app inbox. Rows carry a kind, a dedupe key and a message id - no free text and
-- no amounts, so the inbox is never a second copy of the data. The phone fires its own local reminders.
CREATE TABLE notification_prefs (
  user_id         INTEGER PRIMARY KEY REFERENCES users(id),
  shift_reminders INTEGER NOT NULL DEFAULT 1 CHECK (shift_reminders IN (0,1)),
  goals           INTEGER NOT NULL DEFAULT 1 CHECK (goals IN (0,1)),
  tax_deadlines   INTEGER NOT NULL DEFAULT 1 CHECK (tax_deadlines IN (0,1)),
  streak          INTEGER NOT NULL DEFAULT 1 CHECK (streak IN (0,1)),
  backup          INTEGER NOT NULL DEFAULT 1 CHECK (backup IN (0,1)),
  sync_reminder   INTEGER NOT NULL DEFAULT 1 CHECK (sync_reminder IN (0,1))
);
CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  kind       TEXT    NOT NULL CHECK (kind IN ('badge','challenge','level_up','streak_freeze','streak_risk','goal_met','tax_deadline','shift_reminder','backup_overdue','backup_failed','recurring_expense_due')),
  dedupe_key TEXT    NOT NULL,
  body_key   TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  read_at    INTEGER,
  dismissed_at INTEGER,   -- a dismissed row stays so its dedupe key keeps it from coming back
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX idx_notif_user ON notifications(user_id, created_at DESC);
