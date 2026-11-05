-- 18 section 5.2. Expenses are tax records: never auto-deleted (07 section 4.2).
CREATE TABLE expenses (
  id               INTEGER PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  spent_on         TEXT    NOT NULL,
  category         TEXT    NOT NULL,
  amount_cents     INTEGER NOT NULL CHECK (amount_cents > 0),
  merchant         TEXT    NOT NULL DEFAULT '',
  deductible       INTEGER NOT NULL DEFAULT 1 CHECK (deductible IN (0,1)),
  business_pct     INTEGER NOT NULL DEFAULT 100 CHECK (business_pct BETWEEN 0 AND 100),
  tax_credit_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_credit_cents >= 0 AND tax_credit_cents <= amount_cents),
  vehicle_id       INTEGER REFERENCES vehicles(id),
  shift_id         INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  notes            TEXT,
  recurrence       TEXT    CHECK (recurrence IN ('weekly','monthly','yearly')),
  next_due         TEXT,
  snoozed_until    TEXT,
  template_id      INTEGER REFERENCES expenses(id),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  CHECK ((recurrence IS NULL) = (next_due IS NULL))
);
CREATE INDEX idx_exp_user_date ON expenses(user_id, spent_on);
CREATE INDEX idx_exp_user_cat  ON expenses(user_id, category, spent_on);
CREATE INDEX idx_exp_due       ON expenses(user_id, next_due) WHERE recurrence IS NOT NULL;
