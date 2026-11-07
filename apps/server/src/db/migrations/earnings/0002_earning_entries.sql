-- 22 section 3: earnings as entries. A row per shift and platform keeps its orders, time and notes;
-- the money moves into entries with a signed amount. The sign is the effect on what the platform
-- owes the driver, so the balance is the plain sum. Totals are always sums, never stored.
CREATE TABLE earning_entries (
  id           INTEGER PRIMARY KEY,
  earnings_id  INTEGER NOT NULL REFERENCES shift_earnings(id) ON DELETE CASCADE,
  type         TEXT    NOT NULL CHECK (type IN ('fare','tip','bonus','cash_collected','commission',
                                                'platform_fee','tax_withheld','top_up','payout','adjustment')),
  amount_cents INTEGER NOT NULL CHECK (CASE
                 WHEN type IN ('fare','tip','bonus','top_up') THEN amount_cents > 0
                 WHEN type = 'adjustment' THEN amount_cents <> 0
                 ELSE amount_cents < 0 END),
  note         TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_entries_earnings ON earning_entries(earnings_id);

-- Today's three amounts become entries. A zero means nothing to record; the row itself stays,
-- so "the driver entered zero" still differs from "nothing entered".
INSERT INTO earning_entries (earnings_id, type, amount_cents, created_at)
  SELECT id, 'fare', gross_cents, edited_at FROM shift_earnings WHERE gross_cents > 0;
INSERT INTO earning_entries (earnings_id, type, amount_cents, created_at)
  SELECT id, 'tip', tips_cents, edited_at FROM shift_earnings WHERE tips_cents > 0;
INSERT INTO earning_entries (earnings_id, type, amount_cents, created_at)
  SELECT id, 'bonus', bonus_cents, edited_at FROM shift_earnings WHERE bonus_cents > 0;

ALTER TABLE shift_earnings DROP COLUMN gross_cents;
ALTER TABLE shift_earnings DROP COLUMN tips_cents;
ALTER TABLE shift_earnings DROP COLUMN bonus_cents;
