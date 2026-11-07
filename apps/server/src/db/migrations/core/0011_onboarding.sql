-- Plan 23: the web onboarding wizard. `onboarded_at` (epoch ms) is set when the driver finishes it;
-- `work_kinds` is the JSON list of plan 21 work kinds the driver chose (null: not chosen).
ALTER TABLE settings ADD COLUMN onboarded_at INTEGER;
ALTER TABLE settings ADD COLUMN work_kinds   TEXT;
-- Owners who already have a vehicle set up before the wizard existed: they do not see it
-- (plan 23 section 4.3, assumption for the owner to confirm).
UPDATE settings SET onboarded_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE user_id IN (SELECT user_id FROM vehicles);
