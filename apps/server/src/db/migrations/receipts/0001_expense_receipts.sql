-- 18 section 5.4: one receipt file per expense. The bytes live under data/receipts/ and are
-- copied into every backup (backup/engine.ts), so a restore brings them back.
CREATE TABLE expense_receipts (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  expense_id INTEGER NOT NULL UNIQUE REFERENCES expenses(id) ON DELETE CASCADE,
  file       TEXT    NOT NULL,
  mime       TEXT    NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp','application/pdf')),
  bytes      INTEGER NOT NULL CHECK (bytes > 0),
  sha256     TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
