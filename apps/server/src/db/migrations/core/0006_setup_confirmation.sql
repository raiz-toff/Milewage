-- 08 section 2.3: setup is complete only when the driver has typed back the end of the recovery key.
-- Instances created before this migration have no recovery key to confirm.
ALTER TABLE instance ADD COLUMN setup_confirmed_at INTEGER;
UPDATE instance SET setup_confirmed_at = 0;
